import { LanguageLevel } from "@/generated/prisma/enums";
import { knownLanguage } from "@/lib/document-language";
import { LANGUAGE_LEVELS } from "@/lib/profile";

// The words a document adds around the profile's own: section headings,
// "Present", language levels, "Age 34", and a cover letter's recipient and
// greeting where the AI didn't write them. Each language in the "Write
// documents in" list has its own; any other language gets English ones,
// like the app around them.

export type DocumentLabels = {
  /** For month names and digits, e.g. "de". */
  locale: string;
  profile: string;
  experience: string;
  projects: string;
  education: string;
  skills: string;
  languages: string;
  contact: string;
  references: string;
  /** The end of an ongoing role: "Mar 2021 – Present". */
  present: string;
  /** "Age 34", given the number in the locale's digits. */
  age: (years: string) => string;
  levels: Record<LanguageLevel, string>;
  /** A cover letter's recipient, after the company's name: "Northwind · Hiring team". */
  hiringTeam: string;
  /** A cover letter's greeting; the company may be empty. */
  greeting: (company: string) => string;
};

type Words = Omit<DocumentLabels, "locale">;

/** The levels in the profile's order: native, then C2 down to A1. */
const levels = ([native, c2, c1, b2, b1, a2, a1]: readonly [string, string, string, string, string, string, string]): Record<LanguageLevel, string> => ({
  [LanguageLevel.NATIVE]: native,
  [LanguageLevel.C2]: c2,
  [LanguageLevel.C1]: c1,
  [LanguageLevel.B2]: b2,
  [LanguageLevel.B1]: b1,
  [LanguageLevel.A2]: a2,
  [LanguageLevel.A1]: a1,
});

/** By language tag, as in DOCUMENT_LANGUAGES. */
const WORDS: Record<string, Words> = {
  en: {
    profile: "Profile",
    experience: "Experience",
    projects: "Projects",
    education: "Education",
    skills: "Skills",
    languages: "Languages",
    contact: "Contact",
    references: "References",
    present: "Present",
    age: (years) => `Age ${years}`,
    // As the profile editor names them.
    levels: Object.fromEntries(LANGUAGE_LEVELS.map(({ value, label }) => [value, label])) as Record<LanguageLevel, string>,
    hiringTeam: "Hiring team",
    greeting: (company) => (company ? `Dear ${company} team,` : "Dear hiring team,"),
  },
  nl: {
    profile: "Profiel",
    experience: "Werkervaring",
    projects: "Projecten",
    education: "Opleiding",
    skills: "Vaardigheden",
    languages: "Talen",
    contact: "Contact",
    references: "Referenties",
    present: "Heden",
    age: (years) => `${years} jaar`,
    levels: levels(["Moedertaal", "Vloeiend (C2)", "Zeer goed (C1)", "Goed (B2)", "Redelijk (B1)", "Basis (A2)", "Beginner (A1)"]),
    hiringTeam: "Recruitmentteam",
    greeting: (company) => (company ? `Beste team van ${company},` : "Geachte heer, mevrouw,"),
  },
  de: {
    profile: "Profil",
    experience: "Berufserfahrung",
    projects: "Projekte",
    education: "Ausbildung",
    skills: "Kenntnisse",
    languages: "Sprachen",
    contact: "Kontakt",
    references: "Referenzen",
    present: "Heute",
    age: (years) => `${years} Jahre`,
    levels: levels(["Muttersprache", "Fließend (C2)", "Fortgeschritten (C1)", "Gute Kenntnisse (B2)", "Mittelstufe (B1)", "Grundkenntnisse (A2)", "Anfänger (A1)"]),
    hiringTeam: "Personalabteilung",
    greeting: () => "Sehr geehrte Damen und Herren,",
  },
  fr: {
    profile: "Profil",
    experience: "Expérience professionnelle",
    projects: "Projets",
    education: "Formation",
    skills: "Compétences",
    languages: "Langues",
    contact: "Contact",
    references: "Références",
    present: "Aujourd’hui",
    age: (years) => `${years} ans`,
    levels: levels(["Langue maternelle", "Courant (C2)", "Avancé (C1)", "Intermédiaire supérieur (B2)", "Intermédiaire (B1)", "Élémentaire (A2)", "Débutant (A1)"]),
    hiringTeam: "Service recrutement",
    greeting: () => "Madame, Monsieur,",
  },
  es: {
    profile: "Perfil",
    experience: "Experiencia profesional",
    projects: "Proyectos",
    education: "Formación",
    skills: "Habilidades",
    languages: "Idiomas",
    contact: "Contacto",
    references: "Referencias",
    present: "Actualidad",
    age: (years) => `${years} años`,
    levels: levels(["Nativo", "Fluido (C2)", "Avanzado (C1)", "Intermedio alto (B2)", "Intermedio (B1)", "Básico (A2)", "Principiante (A1)"]),
    hiringTeam: "Equipo de selección",
    greeting: (company) => (company ? `Estimado equipo de ${company}:` : "Estimado equipo de selección:"),
  },
  it: {
    profile: "Profilo",
    experience: "Esperienza professionale",
    projects: "Progetti",
    education: "Formazione",
    skills: "Competenze",
    languages: "Lingue",
    contact: "Contatti",
    references: "Referenze",
    present: "Oggi",
    age: (years) => `${years} anni`,
    levels: levels(["Madrelingua", "Fluente (C2)", "Avanzato (C1)", "Intermedio superiore (B2)", "Intermedio (B1)", "Elementare (A2)", "Principiante (A1)"]),
    hiringTeam: "Ufficio selezione",
    greeting: (company) => (company ? `Gentile team di ${company},` : "Gentili responsabili della selezione,"),
  },
  pt: {
    profile: "Perfil",
    experience: "Experiência profissional",
    projects: "Projetos",
    education: "Formação",
    skills: "Competências",
    languages: "Idiomas",
    contact: "Contato",
    references: "Referências",
    present: "Atual",
    age: (years) => `${years} anos`,
    levels: levels(["Nativo", "Fluente (C2)", "Avançado (C1)", "Intermediário superior (B2)", "Intermediário (B1)", "Básico (A2)", "Iniciante (A1)"]),
    hiringTeam: "Equipe de recrutamento",
    greeting: (company) => (company ? `Prezada equipe de ${company},` : "Prezada equipe de recrutamento,"),
  },
  pl: {
    profile: "Profil",
    experience: "Doświadczenie zawodowe",
    projects: "Projekty",
    education: "Wykształcenie",
    skills: "Umiejętności",
    languages: "Języki",
    contact: "Kontakt",
    references: "Referencje",
    present: "Obecnie",
    age: (years) => `Wiek: ${years}`,
    levels: levels(["Język ojczysty", "Biegły (C2)", "Zaawansowany (C1)", "Wyższy średnio zaawansowany (B2)", "Średnio zaawansowany (B1)", "Podstawowy (A2)", "Początkujący (A1)"]),
    hiringTeam: "Dział rekrutacji",
    greeting: () => "Szanowni Państwo,",
  },
  sv: {
    profile: "Profil",
    experience: "Arbetslivserfarenhet",
    projects: "Projekt",
    education: "Utbildning",
    skills: "Kompetenser",
    languages: "Språk",
    contact: "Kontakt",
    references: "Referenser",
    present: "Nu",
    age: (years) => `${years} år`,
    levels: levels(["Modersmål", "Flytande (C2)", "Avancerad (C1)", "Övre medelnivå (B2)", "Medelnivå (B1)", "Grundläggande (A2)", "Nybörjare (A1)"]),
    hiringTeam: "Rekryteringsteamet",
    greeting: () => "Hej,",
  },
  da: {
    profile: "Profil",
    experience: "Erhvervserfaring",
    projects: "Projekter",
    education: "Uddannelse",
    skills: "Kompetencer",
    languages: "Sprog",
    contact: "Kontakt",
    references: "Referencer",
    present: "Nu",
    age: (years) => `${years} år`,
    levels: levels(["Modersmål", "Flydende (C2)", "Avanceret (C1)", "Øvre mellemniveau (B2)", "Mellemniveau (B1)", "Grundlæggende (A2)", "Begynder (A1)"]),
    hiringTeam: "Rekrutteringsteamet",
    greeting: () => "Kære rekrutteringsansvarlige,",
  },
  no: {
    profile: "Profil",
    experience: "Arbeidserfaring",
    projects: "Prosjekter",
    education: "Utdanning",
    skills: "Kompetanse",
    languages: "Språk",
    contact: "Kontakt",
    references: "Referanser",
    present: "Nå",
    age: (years) => `${years} år`,
    levels: levels(["Morsmål", "Flytende (C2)", "Avansert (C1)", "Øvre middels (B2)", "Middels (B1)", "Grunnleggende (A2)", "Nybegynner (A1)"]),
    hiringTeam: "Rekrutteringsteamet",
    greeting: () => "Hei,",
  },
  fi: {
    profile: "Profiili",
    experience: "Työkokemus",
    projects: "Projektit",
    education: "Koulutus",
    skills: "Osaaminen",
    languages: "Kielitaito",
    contact: "Yhteystiedot",
    references: "Suosittelijat",
    present: "Nyt",
    age: (years) => `${years} vuotta`,
    levels: levels(["Äidinkieli", "Sujuva (C2)", "Edistynyt (C1)", "Hyvä (B2)", "Keskitaso (B1)", "Perustaso (A2)", "Alkeet (A1)"]),
    hiringTeam: "Rekrytointitiimi",
    greeting: () => "Hyvä vastaanottaja,",
  },
  cs: {
    profile: "Profil",
    experience: "Pracovní zkušenosti",
    projects: "Projekty",
    education: "Vzdělání",
    skills: "Dovednosti",
    languages: "Jazyky",
    contact: "Kontakt",
    references: "Reference",
    present: "Dosud",
    age: (years) => `Věk: ${years}`,
    levels: levels(["Mateřský jazyk", "Plynulá znalost (C2)", "Pokročilý (C1)", "Středně pokročilý (B2)", "Mírně pokročilý (B1)", "Základní (A2)", "Začátečník (A1)"]),
    hiringTeam: "Personální oddělení",
    greeting: () => "Vážená paní, vážený pane,",
  },
  el: {
    profile: "Προφίλ",
    experience: "Επαγγελματική εμπειρία",
    projects: "Έργα",
    education: "Εκπαίδευση",
    skills: "Δεξιότητες",
    languages: "Γλώσσες",
    contact: "Επικοινωνία",
    references: "Συστάσεις",
    present: "Σήμερα",
    age: (years) => `${years} ετών`,
    levels: levels(["Μητρική γλώσσα", "Άπταιστα (C2)", "Προχωρημένο (C1)", "Ανώτερο μέσο (B2)", "Μέσο (B1)", "Βασικό (A2)", "Αρχάριο (A1)"]),
    hiringTeam: "Τμήμα προσλήψεων",
    greeting: () => "Αξιότιμες κυρίες και κύριοι,",
  },
  tr: {
    profile: "Profil",
    experience: "İş deneyimi",
    projects: "Projeler",
    education: "Eğitim",
    skills: "Yetkinlikler",
    languages: "Diller",
    contact: "İletişim",
    references: "Referanslar",
    present: "Günümüz",
    age: (years) => `${years} yaşında`,
    levels: levels(["Anadil", "Akıcı (C2)", "İleri (C1)", "Orta üstü (B2)", "Orta (B1)", "Temel (A2)", "Başlangıç (A1)"]),
    hiringTeam: "İnsan Kaynakları",
    greeting: () => "Sayın Yetkili,",
  },
  ar: {
    profile: "نبذة شخصية",
    experience: "الخبرة المهنية",
    projects: "المشاريع",
    education: "التعليم",
    skills: "المهارات",
    languages: "اللغات",
    contact: "التواصل",
    references: "المراجع",
    present: "حتى الآن",
    age: (years) => `العمر: ${years}`,
    levels: levels(["اللغة الأم", "طلاقة (C2)", "متقدم (C1)", "فوق المتوسط (B2)", "متوسط (B1)", "أساسي (A2)", "مبتدئ (A1)"]),
    hiringTeam: "فريق التوظيف",
    greeting: () => "السادة المحترمون،",
  },
  fa: {
    profile: "درباره من",
    experience: "سوابق کاری",
    projects: "پروژه‌ها",
    education: "تحصیلات",
    skills: "مهارت‌ها",
    languages: "زبان‌ها",
    contact: "اطلاعات تماس",
    references: "معرف‌ها",
    present: "تاکنون",
    age: (years) => `${years} سال`,
    levels: levels(["زبان مادری", "مسلط (C2)", "پیشرفته (C1)", "بالاتر از متوسط (B2)", "متوسط (B1)", "مقدماتی (A2)", "مبتدی (A1)"]),
    hiringTeam: "واحد منابع انسانی",
    greeting: () => "با سلام و احترام،",
  },
  hi: {
    profile: "प्रोफ़ाइल",
    experience: "कार्य अनुभव",
    projects: "परियोजनाएँ",
    education: "शिक्षा",
    skills: "कौशल",
    languages: "भाषाएँ",
    contact: "संपर्क",
    references: "संदर्भ",
    present: "वर्तमान",
    age: (years) => `आयु ${years} वर्ष`,
    levels: levels(["मातृभाषा", "धाराप्रवाह (C2)", "उन्नत (C1)", "उच्च-मध्यम (B2)", "मध्यम (B1)", "प्रारंभिक (A2)", "शुरुआती (A1)"]),
    hiringTeam: "भर्ती टीम",
    greeting: () => "आदरणीय महोदय/महोदया,",
  },
  "zh-Hans": {
    profile: "个人简介",
    experience: "工作经历",
    projects: "项目经历",
    education: "教育背景",
    skills: "技能",
    languages: "语言能力",
    contact: "联系方式",
    references: "推荐人",
    present: "至今",
    age: (years) => `${years}岁`,
    levels: levels(["母语", "流利（C2）", "高级（C1）", "中高级（B2）", "中级（B1）", "初级（A2）", "入门（A1）"]),
    hiringTeam: "招聘团队",
    greeting: (company) => (company ? `尊敬的${company}招聘团队：` : "尊敬的招聘负责人："),
  },
  ja: {
    profile: "プロフィール",
    experience: "職歴",
    projects: "プロジェクト",
    education: "学歴",
    skills: "スキル",
    languages: "語学",
    contact: "連絡先",
    references: "推薦者",
    present: "現在",
    age: (years) => `${years}歳`,
    levels: levels(["ネイティブ", "流暢（C2）", "上級（C1）", "中上級（B2）", "中級（B1）", "初級（A2）", "入門（A1）"]),
    hiringTeam: "人事部",
    greeting: () => "採用ご担当者様",
  },
  ko: {
    profile: "프로필",
    experience: "경력",
    projects: "프로젝트",
    education: "학력",
    skills: "기술",
    languages: "언어",
    contact: "연락처",
    references: "추천인",
    present: "현재",
    age: (years) => `${years}세`,
    levels: levels(["원어민", "유창함 (C2)", "고급 (C1)", "중상급 (B2)", "중급 (B1)", "초급 (A2)", "입문 (A1)"]),
    hiringTeam: "채용 담당자",
    greeting: (company) => (company ? `${company} 채용 담당자님께` : "채용 담당자님께"),
  },
};

/** The labels for documents in English, and in any language without its own. */
export const ENGLISH_LABELS: DocumentLabels = { locale: "en-US", ...WORDS.en };

/** The labels for a document written in `language`, a name such as "German". */
export function documentLabels(language: string | null | undefined): DocumentLabels {
  const tag = knownLanguage(language)?.tag;
  const words = tag && tag !== "en" ? WORDS[tag] : undefined;
  return tag && words ? { locale: tag, ...words } : ENGLISH_LABELS;
}

/** "Dutch: Native · English: Fluent (C2)", the profile's languages as a resume lists them. */
export function languagesLine(languages: readonly { name: string; level: LanguageLevel }[], labels: DocumentLabels): string {
  return languages.map((language) => `${language.name}: ${labels.levels[language.level]}`).join(" · ");
}

/** "Age 34", in the document's language and digits. */
export const ageLabel = (years: number, labels: DocumentLabels) => labels.age(new Intl.NumberFormat(labels.locale).format(years));
