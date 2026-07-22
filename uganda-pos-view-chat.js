// =====================================================================
// QWICKPOS — TEAM CHAT VIEW
// =====================================================================
import {
  supabase,
  STATE,
  $,
  escapeHtml,
  toast,
  createNotification,
  fmtDate,
} from "./uganda-pos-core.js";

let _chatChannel = null;
let _activeConvId = null;
let _teamMembers = [];

export async function renderChat(root) {
  _teamMembers = await loadTeamMembers();
  const conversations = await loadConversations();

  root.innerHTML = `
    <div class="chat-layout">
      <div class="chat-sidebar" id="chat-sidebar">
        <div class="chat-sidebar-header">
          <span>Team Chat</span>
          <button class="btn btn-sm btn-primary" id="new-chat-btn">+ New</button>
        </div>
        <div class="chat-list" id="chat-list">
          ${conversations.length ? "" : `<div class="empty-state" style="padding:32px">No conversations yet.<br>Click + New to start one.</div>`}
        </div>
      </div>
      <div class="chat-main" id="chat-main">
        <div class="chat-empty" id="chat-empty">Select a conversation to start chatting</div>
      </div>
    </div>
  `;

  renderConversationList(conversations);
  wireNewChatBtn();
}

async function loadTeamMembers() {
  if (!STATE.business) return [];
  const { data } = await supabase
    .from("app_users")
    .select("id, full_name, role, is_active")
    .eq("business_id", STATE.business.id)
    .eq("is_active", true);
  return data || [];
}

async function loadConversations() {
  if (!STATE.business) return [];
  const { data: memberships } = await supabase
    .from("chat_members")
    .select("conversation_id, last_read_at")
    .eq("user_id", STATE.appUser.id);

  if (!memberships?.length) return [];

  const convIds = memberships.map((m) => m.conversation_id);
  const { data: conversations } = await supabase
    .from("chat_conversations")
    .select("*")
    .in("id", convIds);

  return conversations || [];
}

function renderConversationList(conversations) {
  const list = $("chat-list");
  if (!list) return;
  if (!conversations.length) {
    list.innerHTML = `<div class="empty-state" style="padding:32px">No conversations yet.<br>Click + New to start one.</div>`;
    return;
  }

  list.innerHTML = conversations
    .map((c) => {
      const other = c.is_group
        ? null
        : _teamMembers.find((m) => m.id !== STATE.appUser.id);
      const initials = c.is_group
        ? (c.name || "Group")
            .split(" ")
            .map((s) => s[0])
            .slice(0, 2)
            .join("")
            .toUpperCase()
        : (other?.full_name || "U")
            .split(" ")
            .map((s) => s[0])
            .slice(0, 2)
            .join("")
            .toUpperCase();
      const name = c.is_group
        ? c.name || "Group Chat"
        : other?.full_name || "Unknown";
      return `
      <div class="chat-list-item" data-conv-id="${c.id}">
        <div class="chat-avatar">${escapeHtml(initials)}</div>
        <div class="chat-info">
          <div class="chat-name">${escapeHtml(name)}</div>
          <div class="chat-preview">Click to open</div>
        </div>
      </div>
    `;
    })
    .join("");

  list.querySelectorAll(".chat-list-item").forEach((el) => {
    el.addEventListener("click", () => openConversation(el.dataset.convId));
  });
}

async function openConversation(convId) {
  _activeConvId = convId;

  const sidebar = $("chat-sidebar");
  sidebar?.querySelectorAll(".chat-list-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.convId === convId);
  });

  const main = $("chat-main");
  const { data: conv } = await supabase
    .from("chat_conversations")
    .select("*")
    .eq("id", convId)
    .single();

  if (!conv) return;

  const other = conv.is_group
    ? null
    : _teamMembers.find((m) => m.id !== STATE.appUser.id);
  const name = conv.is_group
    ? conv.name || "Group Chat"
    : other?.full_name || "Unknown";
  const initials = name
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  main.innerHTML = `
    <div class="chat-main-header">
      <div class="chat-avatar" style="width:30px;height:30px;border-radius:50%;background:var(--brand);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700">${escapeHtml(initials)}</div>
      <div class="chat-title">${escapeHtml(name)}</div>
    </div>
    <div class="chat-messages" id="chat-messages"></div>
    <div class="chat-input-row">
      <input type="text" id="chat-input" placeholder="Type a message…" autocomplete="off" />
      <button class="btn btn-primary" id="chat-send-btn">Send</button>
    </div>
  `;

  await loadMessages(convId);
  wireChatInput(convId);
  subscribeToChat(convId);
}

async function loadMessages(convId) {
  const { data: messages } = await supabase
    .from("chat_messages")
    .select("*, sender:app_users!sender_id(full_name)")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: true })
    .limit(100);

  const container = $("chat-messages");
  if (!container) return;
  container.innerHTML = (messages || []).map((m) => renderMessage(m)).join("");
  container.scrollTop = container.scrollHeight;
}

function renderMessage(m) {
  const isMine = m.sender_id === STATE.appUser.id;
  const senderName = m.sender?.full_name || "Unknown";
  const time = new Date(m.created_at).toLocaleTimeString("en-UG", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `
    <div class="chat-msg ${isMine ? "sent" : "received"}">
      ${!isMine ? `<div class="msg-sender">${escapeHtml(senderName)}</div>` : ""}
      <div>${escapeHtml(m.body)}</div>
      <div class="msg-time">${time}</div>
    </div>
  `;
}

function wireChatInput(convId) {
  const input = $("chat-input");
  const btn = $("chat-send-btn");
  if (!input || !btn) return;

  const send = async () => {
    const body = input.value.trim();
    if (!body) return;
    input.value = "";
    await sendMessage(convId, body);
  };

  btn.addEventListener("click", send);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  input.focus();
}

async function sendMessage(convId, body) {
  const { error } = await supabase.from("chat_messages").insert({
    conversation_id: convId,
    sender_id: STATE.appUser.id,
    body,
  });
  if (error) {
    toast("Failed to send message", "error");
    return;
  }

  // Notify other members
  const { data: members } = await supabase
    .from("chat_members")
    .select("user_id")
    .eq("conversation_id", convId)
    .neq("user_id", STATE.appUser.id);

  for (const m of members || []) {
    await createNotification({
      title: STATE.appUser.full_name,
      body: body.length > 80 ? body.slice(0, 80) + "…" : body,
      type: "chat",
      userId: m.user_id,
    });
  }
}

function subscribeToChat(convId) {
  if (_chatChannel) supabase.removeChannel(_chatChannel);

  _chatChannel = supabase
    .channel(`chat:${convId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "chat_messages",
        filter: `conversation_id=eq.${convId}`,
      },
      async (payload) => {
        const m = payload.new;
        if (m.sender_id === STATE.appUser.id) return;
        const container = $("chat-messages");
        if (!container) return;
        const { data: sender } = await supabase
          .from("app_users")
          .select("full_name")
          .eq("id", m.sender_id)
          .single();
        m.sender = sender;
        container.innerHTML += renderMessage(m);
        container.scrollTop = container.scrollHeight;
      },
    )
    .subscribe();
}

function wireNewChatBtn() {
  const btn = $("new-chat-btn");
  if (!btn) return;
  btn.addEventListener("click", showNewChatModal);
}

function showNewChatModal() {
  const others = _teamMembers.filter((m) => m.id !== STATE.appUser.id);
  if (!others.length) {
    toast("No other team members to chat with", "default");
    return;
  }

  const html = `
    <div class="modal-title-row">
      <h3>New Conversation</h3>
      <button class="btn btn-ghost btn-sm" data-close-modal>&times;</button>
    </div>
    <div class="field">
      <label>Select Team Member</label>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
        ${others
          .map(
            (m) => `
          <button class="btn btn-outline btn-block new-chat-member" data-user-id="${m.id}" style="justify-content:flex-start">
            <span style="font-weight:600">${escapeHtml(m.full_name)}</span>
            <span class="text-muted" style="margin-left:8px;font-size:12px">${m.role.replace("_", " ")}</span>
          </button>
        `,
          )
          .join("")}
      </div>
    </div>
  `;

  const root = $("modal-root");
  root.innerHTML = `
    <div class="modal-overlay" id="active-modal-overlay">
      <div class="modal">${html}</div>
    </div>
  `;

  const overlay = $("active-modal-overlay");
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) root.innerHTML = "";
  });
  root.querySelectorAll("[data-close-modal]").forEach((b) => {
    b.addEventListener("click", () => (root.innerHTML = ""));
  });

  root.querySelectorAll(".new-chat-member").forEach((b) => {
    b.addEventListener("click", async () => {
      const userId = b.dataset.userId;
      root.innerHTML = "";
      await startDM(userId);
    });
  });
}

async function startDM(otherUserId) {
  if (!STATE.business) return;

  // Check if a DM already exists
  const { data: myMemberships } = await supabase
    .from("chat_members")
    .select("conversation_id")
    .eq("user_id", STATE.appUser.id);

  if (myMemberships?.length) {
    for (const m of myMemberships) {
      const { data: conv } = await supabase
        .from("chat_conversations")
        .select("is_group")
        .eq("id", m.conversation_id)
        .single();
      if (conv?.is_group) continue;

      const { data: otherMember } = await supabase
        .from("chat_members")
        .select("user_id")
        .eq("conversation_id", m.conversation_id)
        .eq("user_id", otherUserId)
        .single();
      if (otherMember) {
        await openConversation(m.conversation_id);
        return;
      }
    }
  }

  // Create new DM conversation
  const { data: conv, error } = await supabase
    .from("chat_conversations")
    .insert({
      business_id: STATE.business.id,
      is_group: false,
      created_by: STATE.appUser.id,
    })
    .select()
    .single();

  if (error) {
    toast("Failed to create conversation", "error");
    return;
  }

  await supabase.from("chat_members").insert([
    { conversation_id: conv.id, user_id: STATE.appUser.id },
    { conversation_id: conv.id, user_id: otherUserId },
  ]);

  await openConversation(conv.id);
  const conversations = await loadConversations();
  renderConversationList(conversations);
}
