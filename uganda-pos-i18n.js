// =====================================================================
// QWICKPOS — INTERNATIONALIZATION (i18n)
// Multi-language support: English + Luganda
// =====================================================================

const LANG_KEY = 'ugpos_lang';

const TRANSLATIONS = {
  en: {
    // Navigation
    'nav.dashboard': 'Dashboard',
    'nav.pos': 'Sell (POS)',
    'nav.quotations': 'Quotations',
    'nav.products': 'Products',
    'nav.inventory': 'Inventory',
    'nav.sales': 'Sales',
    'nav.purchases': 'Purchases',
    'nav.customers': 'Customers',
    'nav.suppliers': 'Suppliers',
    'nav.chat': 'Chat',
    'nav.notifications': 'Notifications',
    'nav.email_sms': 'Email & SMS',
    'nav.leads': 'Lead Management',
    'nav.deliveries': 'Deliveries',
    'nav.hrm': 'HRM',
    'nav.audit': 'Audit Logs',
    'nav.efris': 'EFRIS',
    'nav.reports': 'Reports',
    'nav.accounting': 'Accounting',
    'nav.settings': 'Settings',
    'nav.billing': 'Billing',
    'nav.admin': 'Platform Admin',

    // Common
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.add': 'Add',
    'common.search': 'Search',
    'common.export': 'Export',
    'common.import': 'Import',
    'common.loading': 'Loading…',
    'common.no_data': 'No data yet',
    'common.confirm': 'Are you sure?',
    'common.success': 'Success!',
    'common.error': 'Error',
    'common.back': 'Back',
    'common.next': 'Next',
    'common.close': 'Close',
    'common.view': 'View',
    'common.active': 'Active',
    'common.inactive': 'Inactive',

    // POS
    'pos.search': 'Search product, SKU or scan barcode…',
    'pos.all': 'All',
    'pos.cart': 'Current Sale',
    'pos.quotation': 'New Quotation',
    'pos.customer': 'Customer',
    'pos.walk_in': 'Walk-in Customer',
    'pos.subtotal': 'Subtotal',
    'pos.discount': 'Discount',
    'pos.vat': 'VAT (incl.)',
    'pos.total': 'Total',
    'pos.charge': 'Charge',
    'pos.hold': 'Hold Sale',
    'pos.clear': 'Clear',
    'pos.checkout': 'Checkout',
    'pos.pay': 'Pay',
    'pos.receipt': 'Receipt',
    'pos.print': 'Print',
    'pos.sms': 'SMS',

    // Dashboard
    'dash.today_sales': "Today's Sales",
    'dash.month': 'This Month',
    'dash.year': 'This Year',
    'dash.vat_month': 'VAT Collected (Month)',
    'dash.inventory_value': 'Inventory Value',
    'dash.low_stock': 'Low Stock Alerts',
    'dash.outstanding': 'Outstanding Balances',
    'dash.vat_ytd': 'YTD VAT Collected',
    'dash.recent': 'Recent Transactions',
    'dash.top_products': 'Top Selling Products',
    'dash.sales_trend': 'Sales Trend (Last 7 Days)',
    'dash.branch_comparison': 'Store/Branch Comparison',
    'dash.expiry_alerts': 'Expiry Alerts',

    // Products
    'prod.list': 'Product List',
    'prod.add': 'Add New',
    'prod.categories': 'Categories',
    'prod.tax': 'Tax Types',
    'prod.units': 'Units',
    'prod.brands': 'Brands',
    'prod.variants': 'Variants',
    'prod.labels': 'Print Labels',
    'prod.name': 'Product Name',
    'prod.sku': 'SKU',
    'prod.price': 'Selling Price',
    'prod.cost': 'Cost Price',
    'prod.stock': 'Stock',
    'prod.category': 'Category',
    'prod.brand': 'Brand',
    'prod.unit': 'Unit',

    // HRM
    'hrm.employees': 'Employees',
    'hrm.departments': 'Departments',
    'hrm.attendance': 'Attendance',
    'hrm.leave': 'Leave',
    'hrm.payroll': 'Payroll',
    'hrm.settings': 'Settings',
    'hrm.add_employee': 'Add Employee',
    'hrm.first_name': 'First Name',
    'hrm.last_name': 'Last Name',
    'hrm.department': 'Department',
    'hrm.designation': 'Designation',
    'hrm.salary': 'Salary',
    'hrm.status': 'Status',

    // Leads
    'leads.pipeline': 'Pipeline',
    'leads.list': 'List View',
    'leads.source': 'By Source',
    'leads.followups': 'Follow-ups',
    'leads.new_lead': 'New Lead',
    'leads.name': 'Name',
    'leads.company': 'Company',
    'leads.value': 'Value',
    'leads.priority': 'Priority',

    // Deliveries
    'del.list': 'All',
    'del.pending': 'Pending',
    'del.transit': 'In Transit',
    'del.delivered': 'Delivered',
    'del.new': 'New Delivery',
    'del.address': 'Delivery Address',
    'del.assigned': 'Assigned To',

    // Settings
    'set.business': 'Business Profile',
    'set.branches': 'Branches',
    'set.currencies': 'Currencies',
    'set.team': 'Team Members',
    'set.templates': 'Document Templates',
    'set.backup': 'Database Backup',
    'set.language': 'Language',

    // Reports
    'rpt.sales': 'Sales Analysis',
    'rpt.purchases': 'Purchase Analysis',
    'rpt.tax': 'Tax (VAT) Report',
    'rpt.expenses': 'Expense Report',

    // Accounting
    'acc.general_ledger': 'General Ledger',
    'acc.journal': 'Journal Entries',
    'acc.trial_balance': 'Trial Balance',
    'acc.expenses': 'Expenses',
    'acc.pnl': 'Profit & Loss',
    'acc.balance_sheet': 'Balance Sheet',
    'acc.cash_flow': 'Cash Flow',
  },

  lg: {
    // Navigation (Luganda)
    'nav.dashboard': 'Eddoboozi',
    'nav.pos': 'Kufulumisa (POS)',
    'nav.quotations': 'Ensimbi z'Ensonga',
    'nav.products': 'Bintu',
    'nav.inventory': 'Ebigolokotole',
    'nav.sales': 'Okugurisha',
    'nav.purchases': 'Okugula',
    'nav.customers': 'Abaguzi',
    'nav.suppliers': 'Abatuma',
    'nav.chat': 'Okwogera',
    'nav.notifications': 'Enyigiraganya',
    'nav.email_sms': 'Email ne SMS',
    'nav.leads': 'Kulondoola Abaguzi',
    'nav.deliveries': 'Okutuma',
    'nav.hrm': 'Abakozi',
    'nav.audit': 'Obujulizi',
    'nav.efris': 'EFRIS',
    'nav.reports': 'Biramu',
    'nav.accounting': 'Akawunti',
    'nav.settings': 'Okulaga',
    'nav.billing': 'Okusimirira',
    'nav.admin': 'Omuyizi',

    // Common
    'common.save': 'Kuuma',
    'common.cancel': 'Kujja',
    'common.delete': 'Saza',
    'common.edit': 'Kulongoosa',
    'common.add': 'Yongera',
    'common.search': 'Kunoonya',
    'common.export': 'Zziyinda',
    'common.import': 'Zzinziriza',
    'common.loading': 'Nkunonyerezesa…',
    'common.no_data': 'Tewali kintu',
    'common.confirm': 'Oli wa nze?',
    'common.success': 'Nkiriye!',
    'common.error': 'Kiwulire',
    'common.back': 'Dda',
    'common.next': 'Edde',
    'common.close': 'Galira',
    'common.view': 'Laba',
    'common.active': 'Kiriko',
    'common.inactive': 'Kirijja',

    // POS
    'pos.search': 'Noonya kintu, SKU ota barcode…',
    'pos.all': 'Byonna',
    'pos.cart': 'Okugurisha Ku',
    'pos.quotation': 'Ensimbi',
    'pos.customer': 'Omuguzi',
    'pos.walk_in': 'Omuguzi ey'aja',
    'pos.subtotal': 'Emirundi',
    'pos.discount': 'Okujanjaba',
    'pos.vat': 'VAT (ey'awera)',
    'pos.total': 'Byonna',
    'pos.charge': 'Saba',
    'pos.hold': 'Kweka',
    'pos.clear': 'Saza',
    'pos.checkout': 'Mala',
    'pos.pay': 'Ssente',
    'pos.receipt': 'Kiwatuliro',
    'pos.print': 'Printa',
    'pos.sms': 'SMS',

    // Dashboard
    'dash.today_sales': 'Ebigurishwa lero',
    'dash.month': 'Oli mwezi',
    'dash.year': 'Oli mwaka',
    'dash.vat_month': 'VAT eweebwa (mwezi)',
    'dash.inventory_value': 'Obubonero bw’ebintu',
    'dash.low_stock': 'Ebigolokotole ebirala',
    'dash.outstanding': 'Ebiwereebwa',
    'dash.vat_ytd': 'VAT eweebwa (mwaka)',
    'dash.recent': 'Ebigurishwa eby’adde',
    'dash.top_products': 'Ebigurishwa ebikulu',
    'dash.sales_trend': 'Emiyaga y’okugurisha (Miwendo 7)',
    'dash.branch_comparison': 'Okwerengera kw’ebibuga',
    'dash.expiry_alerts': 'Eky’okulabula',

    // Products
    'prod.list': 'Olu lwaki lw’ebintu',
    'prod.add': 'Yongera',
    'prod.categories': 'Amaka',
    'prod.tax': 'Amalipo',
    'prod.units': 'Bintu',
    'prod.brands': 'Amaka g’ebintu',
    'prod.variants': ' Ebintu ebirala',
    'prod.labels': 'Printa Amalabeli',
    'prod.name': 'Erinnya ly’ekintu',
    'prod.sku': 'SKU',
    'prod.price': 'Essimu',
    'prod.cost': 'Ekigumyo',
    'prod.stock': 'Ekigolokotole',
    'prod.category': 'Ekika',
    'prod.brand': 'Erinnya ly’ekintu',
    'prod.unit': 'Ekintu',

    // HRM
    'hrm.employees': 'Abakozi',
    'hrm.departments': 'Amaka g’abakozi',
    'hrm.attendance': 'Okubeera',
    'hrm.leave': 'Okusirira',
    'hrm.payroll': 'Essente z’abakozi',
    'hrm.settings': 'Okulaga',
    'hrm.add_employee': 'Yongera Omukozi',
    'hrm.first_name': 'Erinnya',
    'hrm.last_name': 'Olunyiriri',
    'hrm.department': 'Ekika',
    'hrm.designation': 'Omulimu',
    'hrm.salary': 'Essente',
    'hrm.status': 'Omu',

    // Leads
    'leads.pipeline': 'Enkolo',
    'leads.list': 'Olu lwaki',
    'leads.source': 'Ku mutwe',
    'leads.followups': 'Okulabirira',
    'leads.new_lead': 'Omuguzi omupya',
    'leads.name': 'Erinnya',
    'leads.company': 'Kampuni',
    'leads.value': 'Obubonero',
    'leads.priority': 'Ekikulu',

    // Deliveries
    'del.list': 'Byonna',
    'del.pending': 'Binonnyezesebwa',
    'del.transit': 'Biri mu nkola',
    'del.delivered': 'Birabwelawo',
    'del.new': 'Kutuma Kipya',
    'del.address': 'Ekibinja',
    'del.assigned': 'Omulimu',

    // Settings
    'set.business': 'Amakuru g’Akasima',
    'set.branches': 'Ebibuga',
    'set.currencies': 'Amasente',
    'set.team': 'Abakozi',
    'set.templates': 'Amategeko g’Ebikwata',
    'set.backup': 'Kuuma Amakuru',
    'set.language': 'Olulimi',

    // Reports
    'rpt.sales': 'Okwerengera kw’okugurisha',
    'rpt.purchases': 'Okwerengera kw’okugula',
    'rpt.tax': 'Amalipo (VAT)',
    'rpt.expenses': 'Amagiro',

    // Accounting
    'acc.general_ledger': 'Ekigalo ekitongole',
    'acc.journal': 'Amakuru g’Ensonga',
    'acc.trial_balance': 'Okwerengera',
    'acc.expenses': 'Amagiro',
    'acc.pnl': 'Obubonero n’Amagiro',
    'acc.balance_sheet': 'Ekigalo',
    'acc.cash_flow': 'Okuyingira kw’Essente',
  },
};

let currentLang = localStorage.getItem(LANG_KEY) || 'en';

export function t(key) {
  return TRANSLATIONS[currentLang]?.[key] || TRANSLATIONS.en?.[key] || key;
}

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  if (TRANSLATIONS[lang]) {
    currentLang = lang;
    localStorage.setItem(LANG_KEY, lang);
    document.documentElement.lang = lang;
  }
}

export function getAvailableLanguages() {
  return [
    { code: 'en', name: 'English', native: 'English' },
    { code: 'lg', name: 'Luganda', native: 'Olulimi olwa Luganda' },
  ];
}

// Translate all elements with data-i18n attribute
export function translatePage() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    const translated = t(key);
    if (translated && translated !== key) {
      el.textContent = translated;
    }
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    const translated = t(key);
    if (translated && translated !== key) {
      el.title = translated;
    }
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    const translated = t(key);
    if (translated && translated !== key) {
      el.placeholder = translated;
    }
  });
}

// Initialize language on load
document.documentElement.lang = currentLang;
