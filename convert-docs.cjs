const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, TableRow, TableCell,
  Table, WidthType, AlignmentType, BorderStyle, ShadingType, ExternalHyperlink,
  TabStopType, TabStopPosition, convertInchesToTwip,
} = require("docx");

const BRAND = "#0f6b4a";

function parseMarkdown(md) {
  const lines = md.split("\n");
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Horizontal rule
    if (/^---+\s*$/.test(line)) {
      elements.push(new Paragraph({ children: [], spacing: { after: 200 }, border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" } } }));
      i++; continue;
    }

    // Headings
    const hMatch = line.match(/^(#{1,4})\s+(.*)/);
    if (hMatch) {
      const level = hMatch[1].length;
      const headingMap = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3, 4: HeadingLevel.HEADING_4 };
      elements.push(new Paragraph({
        heading: headingMap[level] || HeadingLevel.HEADING_4,
        children: [new TextRun({ text: hMatch[2], bold: true, color: level <= 2 ? BRAND : undefined })],
        spacing: { before: level === 1 ? 400 : 300, after: 150 },
      }));
      i++; continue;
    }

    // Table detection
    if (line.includes("|") && i + 1 < lines.length && /^\|[\s-:|]+\|$/.test(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && lines[i].includes("|")) {
        const cells = lines[i].split("|").map(c => c.trim()).filter((c, idx, arr) => idx > 0 && idx < arr.length - 1);
        if (cells.length > 0) rows.push(cells);
        i++;
      }
      if (rows.length > 0) {
        const isHeader = (ri) => ri === 0;
        const table = new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: rows.map((row, ri) => new TableRow({
            children: row.map(cell => new TableCell({
              children: [new Paragraph({
                children: parseInline(isHeader(ri) ? cell.toUpperCase() : cell),
                spacing: { after: 40 },
              })],
              shading: isHeader(ri) ? { type: ShadingType.SOLID, color: BRAND, fill: BRAND } : undefined,
              width: { size: Math.floor(100 / row.length), type: WidthType.PERCENTAGE },
            })),
          })),
        });
        elements.push(table);
        elements.push(new Paragraph({ children: [], spacing: { after: 200 } }));
      }
      continue;
    }

    // Unordered list
    const listMatch = line.match(/^[\s]*[-*+]\s+(.*)/);
    if (listMatch) {
      elements.push(new Paragraph({
        children: parseInline(listMatch[1]),
        bullet: { level: 0 },
        spacing: { after: 60 },
      }));
      i++; continue;
    }

    // Ordered list
    const olMatch = line.match(/^\d+\.\s+(.*)/);
    if (olMatch) {
      elements.push(new Paragraph({
        children: parseInline(olMatch[1]),
        numbering: { reference: "default-numbering", level: 0 },
        spacing: { after: 60 },
      }));
      i++; continue;
    }

    // Code block
    if (line.startsWith("```")) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const codeText = codeLines.join("\n");
      elements.push(new Paragraph({
        children: [new TextRun({ text: codeText, font: "Courier New", size: 18 })],
        spacing: { before: 100, after: 100 },
        shading: { type: ShadingType.SOLID, color: "F5F5F5", fill: "F5F5F5" },
        indent: { left: convertInchesToTwip(0.3) },
      }));
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      elements.push(new Paragraph({
        children: parseInline(line.slice(2)),
        indent: { left: convertInchesToTwip(0.5) },
        border: { left: { style: BorderStyle.SINGLE, size: 3, color: BRAND } },
        spacing: { before: 100, after: 100 },
      }));
      i++; continue;
    }

    // Empty line
    if (line.trim() === "") {
      elements.push(new Paragraph({ children: [], spacing: { after: 100 } }));
      i++; continue;
    }

    // Normal paragraph
    elements.push(new Paragraph({
      children: parseInline(line),
      spacing: { after: 100 },
    }));
    i++;
  }
  return elements;
}

function parseInline(text) {
  const runs = [];
  // Simple inline parser: **bold**, *italic*, `code`, [link](url)
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[(.+?)\]\((.+?)\))/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(new TextRun({ text: text.slice(lastIndex, match.index) }));
    }
    if (match[2]) { // bold
      runs.push(new TextRun({ text: match[2], bold: true }));
    } else if (match[3]) { // italic
      runs.push(new TextRun({ text: match[3], italics: true }));
    } else if (match[4]) { // code
      runs.push(new TextRun({ text: match[4], font: "Courier New", size: 20, shading: { type: ShadingType.SOLID, color: "F0F0F0", fill: "F0F0F0" } }));
    } else if (match[5] && match[6]) { // link
      runs.push(new ExternalHyperlink({ children: [new TextRun({ text: match[5], style: "Hyperlink" })], link: match[6] }));
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    runs.push(new TextRun({ text: text.slice(lastIndex) }));
  }
  return runs.length ? runs : [new TextRun({ text })];
}

async function convertFile(mdPath) {
  const md = fs.readFileSync(mdPath, "utf8");
  const fileName = path.basename(mdPath, ".md");
  const docxPath = path.join(path.dirname(mdPath), fileName + ".docx");

  const doc = new Document({
    numbering: {
      config: [{
        reference: "default-numbering",
        levels: [{ level: 0, format: "decimal", text: "%1.", alignment: AlignmentType.LEFT }],
      }],
    },
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 22 } },
        heading1: { run: { size: 36, bold: true, color: BRAND, font: "Calibri" } },
        heading2: { run: { size: 28, bold: true, color: BRAND, font: "Calibri" } },
        heading3: { run: { size: 24, bold: true, font: "Calibri" } },
        heading4: { run: { size: 22, bold: true, font: "Calibri" } },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1.2), right: convertInchesToTwip(1.2) },
        },
      },
      children: parseMarkdown(md),
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(docxPath, buffer);
  console.log(`  ${fileName}.docx (${(buffer.length / 1024).toFixed(0)} KB)`);
}

async function main() {
  const docsDir = path.join(__dirname, "docs");
  const files = [
    "ura-sandbox-request-letter.md",
    "ura-efris-application.md",
    "ura-sandbox-testing-guide.md",
    "sunsystems-efris-integration.md",
  ];

  console.log("Converting docs to Word format...\n");
  for (const f of files) {
    const fp = path.join(docsDir, f);
    if (fs.existsSync(fp)) {
      await convertFile(fp);
    } else {
      console.log(`  SKIP: ${f} (not found)`);
    }
  }
  console.log("\nDone! Files saved in docs/");
}

main().catch(console.error);
