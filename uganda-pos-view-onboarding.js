import { supabase, toast } from "./uganda-pos-core.js";

export const BUSINESS_TYPES = [
  {
    id: "retail",
    label: "Retail / General Store",
    icon: "🏪",
    desc: "General merchandise, groceries, electronics",
  },
  {
    id: "food",
    label: "Food & Restaurant",
    icon: "🍔",
    desc: "Restaurant, cafe, takeaway, bakery — with batch & expiry tracking",
  },
  {
    id: "pharmacy",
    label: "Pharmacy",
    icon: "💊",
    desc: "Medicine, medical supplies — with batch & expiry tracking",
  },
  {
    id: "wholesale",
    label: "Wholesale / Distribution",
    icon: "📦",
    desc: "Bulk sales, quantity pricing, distribution",
  },
  {
    id: "services",
    label: "Services",
    icon: "🛠️",
    desc: "Consulting, repairs, maintenance, appointments",
  },
  {
    id: "manufacturing",
    label: "Manufacturing",
    icon: "🏭",
    desc: "Production, BOM, raw materials tracking",
  },
];

const DEFAULT_SEEDS = {
  retail: {
    categories: [
      { name: "Groceries", icon: "🛒" },
      { name: "Beverages", icon: "🥤" },
      { name: "Snacks", icon: "🍪" },
      { name: "Electronics", icon: "🔌" },
      { name: "Household", icon: "🏠" },
      { name: "Personal Care", icon: "🧴" },
      { name: "Clothing", icon: "👕" },
      { name: "Stationery", icon: "✏️" },
    ],
    settings: {},
  },
  food: {
    categories: [
      { name: "Food", icon: "🍕" },
      { name: "Drinks", icon: "🥤" },
      { name: "Desserts", icon: "🍰" },
      { name: "Breakfast", icon: "🌅" },
      { name: "Lunch", icon: "☀️" },
      { name: "Dinner", icon: "🌙" },
      { name: "Takeaway", icon: "🛍️" },
    ],
    settings: { track_expiry: true, track_batches: true },
  },
  pharmacy: {
    categories: [
      { name: "Medicine (Prescription)", icon: "💊" },
      { name: "Medicine (OTC)", icon: "🧪" },
      { name: "Medical Supplies", icon: "🏥" },
      { name: "First Aid", icon: "🩹" },
      { name: "Vitamins & Supplements", icon: "💚" },
      { name: "Baby Care", icon: "👶" },
    ],
    settings: { track_expiry: true, track_batches: true },
  },
  wholesale: {
    categories: [
      { name: "Bulk Goods", icon: "📦" },
      { name: "Raw Materials", icon: "🧱" },
      { name: "Packaging", icon: "📋" },
      { name: "Industrial Supplies", icon: "🏗️" },
      { name: "Agricultural", icon: "🌾" },
    ],
    settings: { enable_wholesale: true },
  },
  services: {
    categories: [
      { name: "Consulting", icon: "💼" },
      { name: "Repairs", icon: "🔧" },
      { name: "Maintenance", icon: "🛠️" },
      { name: "Education", icon: "📚" },
      { name: "Health & Wellness", icon: "🧘" },
    ],
    settings: { is_service_business: true },
  },
  manufacturing: {
    categories: [
      { name: "Raw Materials", icon: "🧱" },
      { name: "Work in Progress", icon: "⚙️" },
      { name: "Finished Goods", icon: "📦" },
      { name: "Packaging Materials", icon: "📋" },
      { name: "Machinery & Spares", icon: "🔩" },
    ],
    settings: { enable_production: true },
  },
};

export async function seedDefaultsForType(businessId, typeId, branchId) {
  const seed = DEFAULT_SEEDS[typeId];
  if (!seed) return;

  // Insert default categories
  if (seed.categories && seed.categories.length > 0) {
    const { error: catErr } = await supabase.from("categories").insert(
      seed.categories.map((c) => ({
        business_id: businessId,
        name: c.name,
        icon: c.icon,
        is_active: true,
      }))
    );
    if (catErr) console.warn("Category seed failed:", catErr.message);
  }

  // Update business settings
  if (seed.settings && Object.keys(seed.settings).length > 0) {
    const updates = {};
    if (seed.settings.track_expiry) updates.enable_expiry_tracking = true;
    if (seed.settings.track_batches) updates.enable_batch_tracking = true;
    if (seed.settings.enable_wholesale) updates.enable_wholesale_pricing = true;
    if (seed.settings.is_service_business) updates.is_service_business = true;
    if (seed.settings.enable_production) updates.enable_production = true;
    updates.business_type = typeId;

    const { error: bizErr } = await supabase
      .from("businesses")
      .update(updates)
      .eq("id", businessId);
    if (bizErr) console.warn("Business settings update failed:", bizErr.message);
  }

  // Create notification about seeding
  try {
    await supabase.from("notifications").insert({
      business_id: businessId,
      title: `${typeId.charAt(0).toUpperCase() + typeId.slice(1)} setup complete`,
      body: `Default categories and settings have been loaded for your ${typeId} business. You can customise them anytime in Settings.`,
      type: "system",
    });
  } catch (_) {}
}
