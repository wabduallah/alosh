/** Starter data inserted on first run: subscription plans and promo codes. Games are added by the new games list. */
export const SEED_PLANS = [
  {
    id: "free",
    nameAr: "مجاني",
    nameEn: "Free",
    price: 0,
    interval: "free",
    featuresAr: ["ألعاب مختارة", "غرف محدودة يوميًا", "حتى 14 لاعبًا"],
    featuresEn: ["A selection of games", "A daily room limit", "Up to 14 players"],
    sort: 1,
  },
  {
    id: "monthly",
    nameAr: "بريميوم شهري",
    nameEn: "Premium monthly",
    price: 29,
    interval: "month",
    featuresAr: ["كل الألعاب", "غرف بلا حد يومي", "بدون مساحة إعلانية", "تخصيص الوقت والجولات"],
    featuresEn: ["Every game", "No daily room cap", "No house ad", "Custom timing and rounds"],
    sort: 2,
  },
  {
    id: "yearly",
    nameAr: "بريميوم سنوي",
    nameEn: "Premium yearly",
    price: 99,
    interval: "year",
    featuresAr: ["كل مزايا الشهري", "سعر السنة أوفر", "ألعاب تُضاف لاحقًا"],
    featuresEn: ["Everything in monthly", "A lower yearly price", "Games added later"],
    sort: 3,
  },
  {
    id: "lifetime",
    nameAr: "مدى الحياة",
    nameEn: "Lifetime",
    price: 199,
    interval: "lifetime",
    featuresAr: ["كل الألعاب", "دفعة واحدة", "غرف خاصة بلا انتهاء الاشتراك"],
    featuresEn: ["Every game", "One payment", "Private rooms without a renewal"],
    sort: 4,
  },
];

export const SEED_PROMOS = [
  { code: "LAMMA50", kind: "percent", amount: 50 },
  { code: "LAMMA30", kind: "days", amount: 30 },
  { code: "LAMMALIFE", kind: "lifetime", amount: 0 },
];
