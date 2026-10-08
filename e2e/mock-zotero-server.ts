import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export type MockLibraryRef = "user" | number;

export interface MockZoteroOptions {
  items?: number;
  groups?: number;
  seed?: number;
  zoteroVersion?: string;
  localPort?: number;
  webPort?: number;
  controlPort?: number;
  running?: boolean;
  localApi?: boolean;
  bbt?: boolean;
  nativeCitationKeys?: boolean | null;
  apiKey?: string;
  userId?: number;
  username?: string;
  backoff?: number | null;
  rateLimit?: number;
  webDown?: boolean;
  revokeKey?: boolean;
}

export interface MockCreator {
  creatorType: string;
  firstName?: string;
  lastName?: string;
  name?: string;
}

export interface MockEditItem {
  library: MockLibraryRef | string;
  key: string;
  fields: Record<string, unknown>;
  sync?: boolean;
  regenerateKey?: boolean;
}

export interface MockAddItem {
  library: MockLibraryRef | string;
  item: Record<string, unknown>;
  sync?: boolean;
}

export interface MockDeleteItem {
  library: MockLibraryRef | string;
  key: string;
  sync?: boolean;
}

export interface MockSetBbtKey {
  library: MockLibraryRef | string;
  key: string;
  citationKey: string;
}

export interface MockZoteroPatch {
  running?: boolean;
  localApi?: boolean;
  bbt?: boolean;
  zoteroVersion?: string;
  nativeCitationKeys?: boolean | null;
  apiKey?: string;
  userId?: number;
  username?: string;
  backoff?: number | null;
  rateLimit?: number;
  webDown?: boolean;
  revokeKey?: boolean;
  addItem?: MockAddItem | MockAddItem[];
  editItem?: MockEditItem | MockEditItem[];
  setBbtKey?: MockSetBbtKey | MockSetBbtKey[];
  deleteItem?: MockDeleteItem | MockDeleteItem[];
  syncNow?: boolean;
  reset?: boolean | { items?: number; groups?: number; seed?: number };
  clearLog?: boolean;
}

export interface MockZoteroResults {
  added: Array<{ library: MockLibraryRef; key: string; citationKey: string; version: number; dateModified: string }>;
  edited: Array<{ library: MockLibraryRef; key: string; citationKey: string; version: number; dateModified: string }>;
  bbtKeys: Array<{ library: MockLibraryRef; key: string; citationKey: string }>;
  deleted: Array<{ library: MockLibraryRef; key: string; version: number }>;
  synced: Array<{ library: MockLibraryRef; version: number; items: number; deletions: number }>;
}

export interface MockRequestLogEntry {
  server: "local" | "web";
  method: string;
  path: string;
  status: number | null;
  rpcMethod?: string;
  headers: {
    "If-Modified-Since-Version": string | null;
    "Zotero-API-Key": "yes" | "no";
    "User-Agent": string | null;
    Origin: string | null;
  };
}

export interface MockLibrarySummary {
  library: MockLibraryRef;
  name: string;
  bbtLibraryID: number;
  itemCount: number;
  libraryVersion: number;
  webItemCount: number;
  webLibraryVersion: number;
  deletedCount: number;
  unsynced: number;
}

export interface MockZoteroStateSummary {
  running: boolean;
  localApi: boolean;
  bbt: boolean;
  zoteroVersion: string;
  nativeCitationKeys: boolean;
  apiKey: string;
  userId: number;
  username: string;
  backoff: number | null;
  rateLimit: number;
  webDown: boolean;
  revokeKey: boolean;
  seed: number;
  itemCount: Record<string, number>;
  libraryVersion: Record<string, number>;
  webItemCount: Record<string, number>;
  webLibraryVersion: Record<string, number>;
  libraries: MockLibrarySummary[];
  requestCounts: Record<string, number>;
  requests: MockRequestLogEntry[];
}

export interface MockZotero {
  local: string;
  web: string;
  control: string;
  setState: (patch: MockZoteroPatch) => Promise<MockZoteroResults>;
  state: () => MockZoteroStateSummary;
  close: () => Promise<void>;
}

interface Item {
  key: string;
  version: number;
  itemType: string;
  fields: Record<string, string>;
  creators: MockCreator[];
  dateAdded: string;
  dateModified: string;
}

interface Library {
  kind: "user" | "group";
  groupId: number;
  bbtId: number;
  name: string;
  groupVersion: number;
  created: string;
  local: Map<string, Item>;
  web: Map<string, Item>;
  localVersion: number;
  webVersion: number;
  deleted: Array<{ key: string; version: number }>;
  bbtKeys: Map<string, string>;
  nativeKeyed: Set<string>;
}

interface World {
  libs: Library[];
  lastStamp: number;
  keyRng: Rng;
}

interface Settings {
  running: boolean;
  localApi: boolean;
  bbt: boolean;
  zoteroVersion: string;
  nativeCitationKeys: boolean | null;
  apiKey: string;
  userId: number;
  username: string;
  backoff: number | null;
  rateLimit: number;
  webDown: boolean;
  revokeKey: boolean;
}

interface ViewContext {
  full: boolean;
  nativeOn: boolean;
  userId: number;
  username: string;
}

interface ItemQuery {
  format: string;
  includeData: boolean;
  includeExports: Flavor[];
  limit: number | null;
  start: number;
  sort: string;
  direction: "asc" | "desc";
  since: number | null;
  itemKeys: Set<string> | null;
  itemTypes: string[];
  q: string | null;
}

interface ParsedDate {
  year?: string;
  month?: number;
  day?: number;
}

interface Reply {
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface GenContext {
  rng: Rng;
  doiBase: number;
  doiNext: number;
  serial: number;
}

interface MadeItem {
  itemType: string;
  fields: Record<string, string>;
  creators: MockCreator[];
  accessed: boolean;
}

interface GeneratedLibrary {
  items: Item[];
  version: number;
  nativeKeyed: string[];
  deleted: Array<{ key: string; version: number }>;
}

type Rng = () => number;
type Flavor = "bibtex" | "biblatex";
type FieldKind = "text" | "tex" | "verbatim" | "raw";

interface BibField {
  name: string;
  value: string;
  kind: FieldKind;
}

const ZOTERO_VERSIONS: Record<string, string> = { "7": "7.0.11", "8": "8.0.4", "9": "9.0.2", "10": "10.0.4" };
const BBT_VERSION = "6.7.240";
const KEY_ALPHABET = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
const YEAR_MS = 365 * 86_400_000;
const START_MS = Date.UTC(2015, 0, 1);
const END_MS = Date.UTC(2026, 5, 30);
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const FORMATS = new Set(["json", "keys", "versions", "bibtex", "biblatex"]);
const SORTS = new Set(["dateModified", "dateAdded", "title"]);
const RESERVED_FIELDS = new Set(["key", "version", "dateAdded", "dateModified", "tags", "collections", "relations"]);
const PATCH_KEYS = new Set([
  "running", "localApi", "bbt", "zoteroVersion", "nativeCitationKeys", "apiKey", "userId", "username",
  "backoff", "rateLimit", "webDown", "revokeKey", "addItem", "editItem", "setBbtKey", "deleteItem",
  "syncNow", "reset", "clearLog",
]);
const TRANSLATORS: Record<string, Flavor> = {
  "better biblatex": "biblatex",
  "f895aa0d-f28e-47fe-b247-2ea77c6ed583": "biblatex",
  "better bibtex": "bibtex",
  "ca65189f-8815-4afe-8c8b-8c7c15f0edca": "bibtex",
};
const GROUP_NAMES = ["Lab Group", "Thesis Committee", "Reading Group", "Grant Proposal", "Teaching Materials", "Systematic Review"];

const TAIL_FIELDS = ["shortTitle", "url", "accessDate", "archive", "archiveLocation", "libraryCatalog", "callNumber", "rights", "extra"];
const SCHEMA: Record<string, string[]> = {
  journalArticle: [
    "abstractNote", "publicationTitle", "volume", "issue", "pages", "date", "series", "seriesTitle", "seriesText",
    "journalAbbreviation", "language", "DOI", "ISSN", ...TAIL_FIELDS,
  ],
  book: [
    "abstractNote", "series", "seriesNumber", "volume", "numberOfVolumes", "edition", "place", "publisher", "date",
    "numPages", "language", "ISBN", ...TAIL_FIELDS,
  ],
  bookSection: [
    "abstractNote", "bookTitle", "series", "seriesNumber", "volume", "numberOfVolumes", "edition", "place",
    "publisher", "date", "pages", "language", "ISBN", ...TAIL_FIELDS,
  ],
  conferencePaper: [
    "abstractNote", "date", "proceedingsTitle", "conferenceName", "place", "publisher", "volume", "pages", "series",
    "language", "DOI", "ISBN", ...TAIL_FIELDS,
  ],
  thesis: ["abstractNote", "thesisType", "university", "place", "date", "numPages", "language", ...TAIL_FIELDS],
  report: [
    "abstractNote", "reportNumber", "reportType", "seriesTitle", "place", "institution", "date", "pages", "language",
    ...TAIL_FIELDS,
  ],
  preprint: [
    "abstractNote", "genre", "repository", "archiveID", "place", "date", "series", "seriesNumber", "DOI", "language",
    ...TAIL_FIELDS,
  ],
  webpage: ["abstractNote", "websiteTitle", "websiteType", "date", "language", ...TAIL_FIELDS],
};

const ITEM_TYPES: ReadonlyArray<readonly [string, number]> = [
  ["journalArticle", 55], ["book", 10], ["bookSection", 8], ["conferencePaper", 12],
  ["thesis", 5], ["report", 4], ["preprint", 4], ["webpage", 2],
];
const AUTHOR_COUNTS: ReadonlyArray<readonly [number, number]> = [[1, 15], [2, 20], [3, 25], [4, 18], [5, 12], [6, 10]];
const NAME_STYLES: ReadonlyArray<readonly [string, number]> = [
  ["en", 40], ["latin", 26], ["zh", 9], ["zhSingle", 3], ["ja", 5], ["ko", 5], ["ru", 5], ["el", 3], ["ar", 3], ["org", 1],
];
const DATE_STYLES: ReadonlyArray<readonly [string, number]> = [
  ["iso", 50], ["year", 22], ["monthYear", 13], ["isoMonth", 5], ["dayMonthYear", 5], ["monthDayYear", 5],
];
const EN_LANGUAGES: ReadonlyArray<readonly [string, number]> = [["en", 85], ["en-US", 5], ["en-GB", 4], ["English", 3], ["", 3]];
const THESIS_TYPES: ReadonlyArray<readonly [string, number]> = [["PhD Thesis", 70], ["Master's Thesis", 20], ["Doctoral dissertation", 10]];
const REPOSITORIES: ReadonlyArray<readonly [string, number]> = [["arXiv", 70], ["bioRxiv", 12], ["SSRN", 10], ["medRxiv", 8]];

const EN_FAMILY = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Miller", "Davis", "Wilson", "Anderson", "Taylor",
  "Thomas", "Moore", "Martin", "Jackson", "Thompson", "White", "Harris", "Clark", "Lewis", "Robinson",
  "Walker", "Young", "Allen", "King", "Wright", "Scott", "Green", "Baker", "Adams", "Nelson",
  "Hill", "Campbell", "Mitchell", "Roberts", "Carter", "Phillips", "Evans", "Turner", "Parker", "Collins",
];
const EN_GIVEN = [
  "James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda", "William", "Elizabeth",
  "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen",
  "Emily", "Daniel", "Laura", "Matthew", "Rachel", "Andrew", "Hannah", "Christopher", "Olivia", "Benjamin",
];
const LATIN_FAMILY = [
  "Müller", "Ångström", "Núñez", "Dvořák", "Łukasiewicz", "Ó Briain", "van der Berg", "de la Cruz", "García",
  "Schröder", "Kovačević", "Nyström", "Østergaard", "Çelik", "Lefèvre", "Hernández", "Wójcik", "Šimek", "Jäger",
  "Fernández", "Kühn", "Sørensen", "Björk", "D'Angelo", "Öztürk", "Le Gall", "dos Santos",
];
const LATIN_GIVEN = [
  "Anna", "Søren", "José", "François", "Zoë", "Björn", "Mária", "Łucja", "Jürgen", "Inés", "Siobhán",
  "Aurélien", "Dagný", "Ľubomír", "Małgorzata", "Jiří", "Sinéad", "Ève", "Ömer", "Nils", "Joaquín", "Gaëlle",
];
const INITIALS = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "R", "S", "T", "W"];
const ZH_FAMILY = ["王", "李", "张", "刘", "陈", "杨", "黄", "赵", "周", "吴"];
const ZH_GIVEN = ["小明", "伟", "芳", "娜", "静", "磊", "洋", "勇", "军", "杰", "丽", "强", "敏", "秀英", "建华"];
const ZH_SINGLE = ["张伟", "李娜", "王芳", "刘洋", "陈静"];
const JA_NAMES: ReadonlyArray<readonly [string, string]> = [["山田", "太郎"], ["佐藤", "花子"], ["鈴木", "一郎"], ["田中", "美咲"], ["高橋", "健"]];
const KO_NAMES: ReadonlyArray<readonly [string, string]> = [["김", "민준"], ["이", "서연"], ["박", "지훈"], ["최", "수빈"], ["정", "하은"]];
const RU_NAMES: ReadonlyArray<readonly [string, string]> = [
  ["Иванов", "Пётр"], ["Смирнова", "Анна"], ["Кузнецов", "Дмитрий"], ["Попова", "Елена"], ["Соколов", "Алексей"],
];
const EL_NAMES: ReadonlyArray<readonly [string, string]> = [
  ["Παπαδόπουλος", "Νίκος"], ["Γεωργίου", "Μαρία"], ["Παππάς", "Γιώργος"], ["Οικονόμου", "Ελένη"],
];
const AR_NAMES: ReadonlyArray<readonly [string, string]> = [["الخطيب", "سارة"], ["حداد", "عمر"], ["منصور", "ليلى"], ["العلي", "يوسف"]];
const ORGANIZATIONS = ["World Health Organization", "OECD", "Intergovernmental Panel on Climate Change", "The Mock Consortium"];

const ROMAN: Record<string, string> = {
  "王": "wang", "李": "li", "张": "zhang", "刘": "liu", "陈": "chen", "杨": "yang", "黄": "huang", "赵": "zhao",
  "周": "zhou", "吴": "wu", "小": "xiao", "明": "ming", "伟": "wei", "芳": "fang", "娜": "na", "静": "jing",
  "磊": "lei", "洋": "yang", "勇": "yong", "军": "jun", "杰": "jie", "丽": "li", "强": "qiang", "敏": "min",
  "秀": "xiu", "英": "ying", "建": "jian", "华": "hua",
  "山田": "yamada", "佐藤": "sato", "鈴木": "suzuki", "田中": "tanaka", "高橋": "takahashi",
  "김": "kim", "이": "lee", "박": "park", "최": "choi", "정": "jung",
  "الخطيب": "alkhatib", "حداد": "haddad", "منصور": "mansour", "العلي": "alali",
};
const CYRILLIC: Record<string, string> = {
  "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ж": "zh", "з": "z", "и": "i", "к": "k",
  "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f",
  "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "iu", "я": "ia",
};
const GREEK: Record<string, string> = {
  "α": "a", "β": "b", "γ": "g", "δ": "d", "ε": "e", "ζ": "z", "η": "i", "θ": "th", "ι": "i", "κ": "k",
  "λ": "l", "μ": "m", "ν": "n", "ξ": "x", "ο": "o", "π": "p", "ρ": "r", "σ": "s", "ς": "s", "τ": "t",
  "υ": "y", "φ": "f", "χ": "ch", "ψ": "ps", "ω": "o",
};
const FOLD: Record<string, string> = {
  "ø": "o", "Ø": "O", "ł": "l", "Ł": "L", "đ": "d", "Đ": "D", "ß": "ss", "æ": "ae", "Æ": "AE",
  "œ": "oe", "Œ": "OE", "þ": "th", "Þ": "Th", "ð": "d", "Ð": "D", "ı": "i",
};
const BBT_SKIP = new Set(
  (
    "a ab aboard about above across after against al along amid among an and anti around as at before behind below " +
    "beneath beside besides between beyond but by d da das de del dell dello dei degli della delle dem den der des " +
    "despite die do down du during ein eine einem einen einer eines el en et except for from gli i il in inside into " +
    "is l la las le les like lo los near nor of off on onto or over past per plus round save since so some sur than " +
    "the through to toward towards un una unas under underneath une unlike uno unos until up upon versus via von " +
    "while with within without yet zu zum"
  ).split(" "),
);
const ZOTERO_BANNED =
  /\b(a|an|the|some|from|on|in|to|of|do|with|der|die|das|ein|eine|einer|eines|einem|einen|un|une|la|le|l'|el|las|los|al|uno|una|unos|unas|de|des|del|d')(\s+|\b)/g;
const ZOTERO_KEY_CLEAN = /[^a-z0-9!$&*+\-./:;<>?[\]^_`|]+/g;
const TEX_ESCAPES: Record<string, string> = {
  "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", "&": "\\&", "%": "\\%", "$": "\\$", "#": "\\#", "_": "\\_",
  "~": "\\textasciitilde{}", "^": "\\textasciicircum{}",
};
const LANGIDS: Record<string, string> = {
  en: "english", english: "english", "en-us": "american", "en-gb": "british", de: "ngerman", "de-de": "ngerman",
  fr: "french", "fr-fr": "french", zh: "chinese",
};

const ADJECTIVES = [
  "deep", "scalable", "robust", "efficient", "probabilistic", "adaptive", "interpretable", "federated", "sparse", "causal",
  "stochastic", "multimodal", "self-supervised", "hierarchical", "distributed", "low-rank", "quantum", "nonlinear",
  "explainable", "contrastive",
];
const NOUNS = [
  "learning", "inference", "networks", "models", "representations", "optimization", "estimation", "segmentation",
  "retrieval", "simulation", "detection", "alignment", "transformers", "embeddings", "dynamics", "sampling",
  "regression", "clustering", "forecasting", "reasoning",
];
const DOMAINS = [
  "protein folding", "climate models", "graph data", "medical imaging", "speech recognition", "citation networks",
  "ocean circulation", "particle physics", "language models", "crop yield prediction", "urban mobility",
  "gene expression", "seismic signals", "financial time series", "scholarly documents", "molecular design",
  "traffic flow", "galaxy surveys", "wildfire risk", "legal texts",
];
const PROPER = [
  "Bayesian", "Markov", "Gaussian", "Fourier", "Monte Carlo", "DNA", "RNA", "COVID-19", "GPU", "LaTeX", "Arctic",
  "European", "BERT", "CRISPR", "MRI", "Wasserstein", "Riemannian", "Hilbert", "Kalman", "Transformer",
];
const PROPERTIES = ["convergence", "complexity", "stability", "limits", "geometry", "robustness", "calibration", "generalization"];
const GERUNDS = ["understanding", "predicting", "modelling", "rethinking", "benchmarking", "scaling", "measuring", "revisiting"];
const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "with", "about"]);
const DE_TITLES = [
  "Über die Anwendung neuronaler Netze in der Proteinforschung",
  "Eine Untersuchung zur Klimamodellierung im Alpenraum",
  "Methoden der statistischen Lerntheorie für große Datensätze",
  "Zur Geschichte der Wahrscheinlichkeitsrechnung im 19. Jahrhundert",
  "Maschinelles Lernen und Rechtsprechung: Eine empirische Studie",
  "Grundlagen der Quanteninformatik",
];
const FR_TITLES = [
  "Sur l'apprentissage profond des structures protéiques",
  "Une étude des réseaux de neurones pour la modélisation du climat",
  "Analyse numérique des équations aux dérivées partielles",
  "Les grands modèles de langue et la recherche documentaire",
  "Économie de la science ouverte en Europe",
  "Réseaux bayésiens pour le diagnostic médical",
];
const ZH_TITLES = [
  "深度学习在蛋白质结构预测中的应用",
  "基于图神经网络的气候模型研究",
  "大规模语言模型的评估方法综述",
  "城市交通流量预测的新方法",
  "面向学术文献的引文推荐系统",
];
const SPECIAL_TITLES = [
  "Profit & Loss in Small Research Labs",
  "Reducing Error by 50% with Ensemble Methods",
  "The $100 Genome: Sequencing Costs Revisited",
  "Mining snake_case Identifiers in Source Code",
  "#OpenScience and Scholarly Communication on Social Media",
  "R&D Spending and 3% Growth Targets",
  "Q&A Retrieval with 99% Recall",
  "Using the _id Field in Document Stores",
];
const BRACE_TITLES = [
  "On the {Fourier} Transform of {Gaussian} Kernels",
  "{LaTeX} Typesetting for {CJK} Documents",
  "A Note on {BibTeX} Case Protection",
];
const SUFFIXES = [": Supplementary Material", ": Extended Version", " (Revisited)", ": Part II", ": A Replication"];
const ABSTRACT_OPENERS = ["We study", "This paper examines", "We revisit", "We present new evidence on", "This work investigates"];
const ABSTRACT_CLOSERS = [
  "Experiments on three benchmarks show consistent gains.",
  "Our results suggest a simpler explanation than previously assumed.",
  "We release code and data to support replication.",
  "The analysis covers twelve years of observations.",
  "Results hold across five independent datasets.",
];
const JOURNALS = [
  "Journal of Mock Studies", "Annals of Applied Simulation", "Computational Linguistics Quarterly",
  "Journal of Machine Learning Research", "Physical Review E", "Bioinformatics", "PLOS Computational Biology",
  "Nature Methods", "Zeitschrift für Naturforschung A", "Revue d'Économie Politique", "Acta Mathematica Sinica",
  "Scientific Reports", "IEEE Transactions on Pattern Analysis and Machine Intelligence", "ACM Computing Surveys",
  "Journal of the Royal Statistical Society: Series B", "Science & Technology Studies", "计算机学报", "Ecology Letters",
];
const CONFERENCES: ReadonlyArray<readonly [string, string]> = [
  ["International Conference on Learning Systems", "ICLS"],
  ["Annual Meeting of the Association for Mock Linguistics", "AML"],
  ["Conference on Computer Vision and Mock Recognition", "CVMR"],
  ["Symposium on Principles of Distributed Mocking", "PODM"],
  ["European Conference on Simulation", "ECS"],
  ["Internationale Tagung Wirtschaftsinformatik", "WI"],
];
const CONF_PUBLISHERS = ["ACM", "IEEE", "Springer", "PMLR", "Association for Computational Linguistics"];
const PUBLISHERS: ReadonlyArray<readonly [string, string]> = [
  ["Springer", "Cham"], ["Cambridge University Press", "Cambridge"], ["Oxford University Press", "Oxford"],
  ["MIT Press", "Cambridge, MA"], ["Elsevier", "Amsterdam"], ["Wiley", "Hoboken, NJ"], ["De Gruyter", "Berlin"],
  ["Éditions du Seuil", "Paris"], ["Princeton University Press", "Princeton, NJ"], ["Routledge", "London"],
  ["科学出版社", "北京"], ["Iwanami Shoten", "Tokyo"],
];
const CITIES = ["Vancouver", "Montréal", "Kyōto", "São Paulo", "Zürich", "Kraków", "Reykjavík", "Seoul", "Athens", "Cairo"];
const UNIVERSITIES = [
  "University of Cambridge", "ETH Zürich", "Université Paris-Saclay", "Tsinghua University", "Københavns Universitet",
  "Universität Wien", "Massachusetts Institute of Technology", "University of Tokyo", "Seoul National University",
  "Lomonosov Moscow State University", "Universidade de São Paulo",
];
const INSTITUTIONS = [
  "National Bureau of Mock Research", "RAND Corporation", "CERN", "Max-Planck-Institut für Informatik",
  "OECD Publishing", "World Bank", "Fraunhofer-Institut für Integrierte Schaltungen",
];
const REPORT_TYPES = ["Technical Report", "Working Paper", "Policy Brief"];
const WEBSITES = ["Mock Science Blog", "The Research Notebook", "Distill", "Towards Mock Data", "Les Carnets de la Recherche"];

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mixSeed(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)] as T;
}

function between(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function weighted<T>(rng: Rng, entries: ReadonlyArray<readonly [T, number]>): T {
  let total = 0;
  for (const [, weight] of entries) total += weight;
  let roll = rng() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return (entries[entries.length - 1] as readonly [T, number])[0];
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function iso(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
}

function newKey(rng: Rng, taken: Set<string>): string {
  for (;;) {
    let key = "";
    for (let i = 0; i < 8; i++) key += KEY_ALPHABET.charAt(Math.floor(rng() * KEY_ALPHABET.length));
    if (!taken.has(key)) {
      taken.add(key);
      return key;
    }
  }
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[øØłŁđĐßæÆœŒþÞðÐı]/g, (ch) => FOLD[ch] ?? ch);
}

function romanize(value: string): string {
  const whole = ROMAN[value];
  if (whole !== undefined) return whole;
  let out = "";
  for (const ch of fold(value).toLowerCase().replace(/ου/g, "ou")) {
    const mapped = ROMAN[ch] ?? CYRILLIC[ch] ?? GREEK[ch];
    if (mapped !== undefined) out += mapped;
    else if (/[a-z0-9]/.test(ch)) out += ch;
  }
  return out;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function titleCase(raw: string): string {
  const words = raw.split(" ");
  return words
    .map((word, index) => {
      const afterColon = index > 0 && (words[index - 1] ?? "").endsWith(":");
      if (index > 0 && !afterColon && SMALL_WORDS.has(word)) return word;
      return word.split("-").map(capitalize).join("-");
    })
    .join(" ");
}

function sentenceCase(raw: string): string {
  return capitalize(raw).replace(/: (.)/g, (_match, ch: string) => `: ${ch.toUpperCase()}`);
}

function slugify(text: string): string {
  return fold(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
}

function parseDate(value: string): ParsedDate {
  const text = value.trim();
  const isoMatch = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/.exec(text);
  if (isoMatch) {
    const month = Number(isoMatch[2]);
    const day = isoMatch[3] ? Number(isoMatch[3]) : undefined;
    return month >= 1 && month <= 12 ? { year: isoMatch[1], month, day } : { year: isoMatch[1] };
  }
  const yearMatch = /(?:^|\D)(\d{4})(?!\d)/.exec(text);
  if (!yearMatch) return {};
  const year = yearMatch[1] as string;
  const tokens = text.toLowerCase().split(/[^a-z]+/);
  const monthIndex = MONTHS.findIndex((abbr) => tokens.some((token) => token.length >= 3 && token.startsWith(abbr)));
  if (monthIndex < 0) return { year };
  const dayMatch = /(?:^|\D)(\d{1,2})(?!\d)/.exec(text.replace(year, " "));
  return { year, month: monthIndex + 1, day: dayMatch ? Number(dayMatch[1]) : undefined };
}

function isoDate(date: ParsedDate): string {
  if (!date.year) return "";
  if (!date.month) return date.year;
  return `${date.year}-${pad2(date.month)}${date.day ? `-${pad2(date.day)}` : ""}`;
}

function cloneCreator(creator: MockCreator): MockCreator {
  if (creator.name !== undefined) return { creatorType: creator.creatorType, name: creator.name };
  return { creatorType: creator.creatorType, firstName: creator.firstName ?? "", lastName: creator.lastName ?? "" };
}

function cloneItem(item: Item): Item {
  return { ...item, fields: { ...item.fields }, creators: item.creators.map(cloneCreator) };
}

function primaryCreators(item: Item): MockCreator[] {
  const authors = item.creators.filter((c) => c.creatorType === "author");
  if (authors.length > 0) return authors;
  const editors = item.creators.filter((c) => c.creatorType === "editor");
  return editors.length > 0 ? editors : item.creators;
}

function creatorName(creator: MockCreator): string {
  return creator.lastName ?? creator.name ?? "";
}

function creatorSummary(item: Item): string {
  const list = primaryCreators(item);
  const first = list[0];
  const second = list[1];
  if (!first) return "";
  if (!second) return creatorName(first);
  if (list.length === 2) return `${creatorName(first)} and ${creatorName(second)}`;
  return `${creatorName(first)} et al.`;
}

function makeDate(rng: Rng): string {
  if (rng() < 0.03) return "";
  const year = 2026 - Math.floor(Math.pow(rng(), 1.7) * 38);
  const month = between(rng, 1, year === 2026 ? 6 : 12);
  const day = between(rng, 1, 28);
  const monthName = MONTH_NAMES[month - 1] ?? "January";
  switch (weighted(rng, DATE_STYLES)) {
    case "iso":
      return `${year}-${pad2(month)}-${pad2(day)}`;
    case "year":
      return String(year);
    case "monthYear":
      return `${monthName} ${year}`;
    case "isoMonth":
      return `${year}-${pad2(month)}`;
    case "dayMonthYear":
      return `${day} ${monthName} ${year}`;
    default:
      return `${monthName} ${day}, ${year}`;
  }
}

function englishTitle(rng: Rng): string {
  const adjective = pick(rng, ADJECTIVES);
  const noun = pick(rng, NOUNS);
  const domain = pick(rng, DOMAINS);
  const proper = pick(rng, PROPER);
  const property = pick(rng, PROPERTIES);
  const gerund = pick(rng, GERUNDS);
  const templates = [
    `${adjective} ${noun} for ${domain}`,
    `${proper} ${noun} for ${domain}`,
    `on the ${property} of ${adjective} ${noun}`,
    `towards ${adjective} ${noun} in ${domain}`,
    `a survey of ${adjective} ${noun}`,
    `${adjective} ${noun}: a ${proper} approach to ${domain}`,
    `${gerund} ${domain} with ${adjective} ${noun}`,
    `what ${domain} can teach us about ${adjective} ${noun}`,
    `${proper}-informed ${noun} of ${domain}`,
  ];
  const raw = pick(rng, templates);
  return rng() < 0.5 ? titleCase(raw) : sentenceCase(raw);
}

function makeTitle(rng: Rng): { text: string; language: string } {
  const roll = rng();
  if (roll < 0.02) return { text: pick(rng, DE_TITLES), language: "de" };
  if (roll < 0.04) return { text: pick(rng, FR_TITLES), language: "fr" };
  if (roll < 0.06) return { text: pick(rng, ZH_TITLES), language: "zh" };
  const language = weighted(rng, EN_LANGUAGES);
  if (roll < 0.07) return { text: pick(rng, SPECIAL_TITLES), language };
  if (roll < 0.074) return { text: pick(rng, BRACE_TITLES), language };
  return { text: englishTitle(rng), language };
}

function makeBookTitle(rng: Rng): string {
  const variant = between(rng, 0, 2);
  if (variant === 0) return `Handbook of ${titleCase(pick(rng, DOMAINS))}`;
  if (variant === 1) return `Advances in ${titleCase(`${pick(rng, ADJECTIVES)} ${pick(rng, NOUNS)}`)}`;
  return `${pick(rng, PROPER)} Methods in Practice`;
}

function makePages(rng: Rng): string {
  const start = between(rng, 1, 900);
  return `${start}${rng() < 0.05 ? "–" : "-"}${start + between(rng, 3, 40)}`;
}

function isbn13(rng: Rng): string {
  const digits = [9, 7, 8];
  for (let i = 0; i < 9; i++) digits.push(between(rng, 0, 9));
  const sum = digits.reduce((acc, digit, index) => acc + digit * (index % 2 === 0 ? 1 : 3), 0);
  const all = `${digits.join("")}${(10 - (sum % 10)) % 10}`;
  return `${all.slice(0, 3)}-${all.slice(3, 4)}-${all.slice(4, 7)}-${all.slice(7, 12)}-${all.slice(12)}`;
}

function ordinal(value: number): string {
  const rem = value % 100;
  const suffix = rem >= 11 && rem <= 13 ? "th" : (["th", "st", "nd", "rd"][value % 10] ?? "th");
  return `${value}${suffix}`;
}

function givenName(rng: Rng, list: readonly string[]): string {
  const name = pick(rng, list);
  if (rng() < 0.06) return `${name.charAt(0)}. ${pick(rng, INITIALS)}.`;
  return name;
}

function pairName(rng: Rng, creatorType: string, list: ReadonlyArray<readonly [string, string]>): MockCreator {
  const [lastName, firstName] = pick(rng, list);
  return { creatorType, firstName, lastName };
}

function makePerson(rng: Rng, creatorType: string): MockCreator {
  switch (weighted(rng, NAME_STYLES)) {
    case "latin":
      return { creatorType, firstName: givenName(rng, LATIN_GIVEN), lastName: pick(rng, LATIN_FAMILY) };
    case "zh":
      return { creatorType, firstName: pick(rng, ZH_GIVEN), lastName: pick(rng, ZH_FAMILY) };
    case "zhSingle":
      return { creatorType, name: pick(rng, ZH_SINGLE) };
    case "ja":
      return pairName(rng, creatorType, JA_NAMES);
    case "ko":
      return pairName(rng, creatorType, KO_NAMES);
    case "ru":
      return pairName(rng, creatorType, RU_NAMES);
    case "el":
      return pairName(rng, creatorType, EL_NAMES);
    case "ar":
      return pairName(rng, creatorType, AR_NAMES);
    case "org":
      return { creatorType, name: pick(rng, ORGANIZATIONS) };
    default:
      return { creatorType, firstName: givenName(rng, EN_GIVEN), lastName: pick(rng, EN_FAMILY) };
  }
}

function makeCreators(rng: Rng, itemType: string): MockCreator[] {
  if (rng() < 0.03) return [];
  const creators: MockCreator[] = [];
  const count = weighted(rng, AUTHOR_COUNTS);
  for (let i = 0; i < count; i++) creators.push(makePerson(rng, "author"));
  const editorChance = itemType === "book" ? 0.3 : itemType === "bookSection" ? 0.6 : 0;
  if (rng() < editorChance) {
    const editors = between(rng, 1, itemType === "book" ? 2 : 3);
    for (let i = 0; i < editors; i++) creators.push(makePerson(rng, "editor"));
  }
  return creators;
}

function makeItem(ctx: GenContext, itemType: string): MadeItem {
  const rng = ctx.rng;
  ctx.serial += 1;
  const serial = ctx.serial;
  const date = makeDate(rng);
  const year = parseDate(date).year ?? String(between(rng, 1995, 2025));
  const title = makeTitle(rng);
  const fields: Record<string, string> = { title: title.text, date, language: title.language, extra: "" };
  if (rng() < 0.6) {
    fields.abstractNote = `${pick(rng, ABSTRACT_OPENERS)} ${title.text.replace(/[{}]/g, "")}. ${pick(rng, ABSTRACT_CLOSERS)}`;
  }
  const slug = `${slugify(title.text) || "item"}-${serial}`;
  const doiCapable = itemType === "journalArticle" || itemType === "conferencePaper" || itemType === "preprint";
  if (doiCapable && rng() < 0.7) {
    fields.DOI = `10.5555/mock.${ctx.doiBase + ctx.doiNext}`;
    ctx.doiNext += 1;
  }
  let accessed = false;
  switch (itemType) {
    case "journalArticle": {
      fields.publicationTitle = pick(rng, JOURNALS);
      fields.volume = String(between(rng, 1, 80));
      if (rng() < 0.8) fields.issue = String(between(rng, 1, 12));
      if (rng() < 0.85) fields.pages = makePages(rng);
      const roll = rng();
      if (roll < 0.55) fields.url = `https://journals.example.org/${slug}`;
      else if (roll < 0.7 && fields.DOI) fields.url = `https://doi.org/${fields.DOI}`;
      break;
    }
    case "book": {
      const [publisher, place] = pick(rng, PUBLISHERS);
      fields.publisher = publisher;
      fields.place = place;
      if (rng() < 0.85) fields.ISBN = isbn13(rng);
      if (rng() < 0.15) fields.edition = String(between(rng, 2, 5));
      if (rng() < 0.2) fields.url = `https://books.example.org/${slug}`;
      break;
    }
    case "bookSection": {
      const [publisher, place] = pick(rng, PUBLISHERS);
      fields.bookTitle = makeBookTitle(rng);
      fields.publisher = publisher;
      fields.place = place;
      if (rng() < 0.9) fields.pages = makePages(rng);
      if (rng() < 0.6) fields.ISBN = isbn13(rng);
      break;
    }
    case "conferencePaper": {
      const [name, acronym] = pick(rng, CONFERENCES);
      fields.proceedingsTitle = `Proceedings of the ${ordinal(Math.max(1, Number(year) - 1985))} ${name}`;
      fields.conferenceName = `${acronym} ${year}`;
      fields.place = pick(rng, CITIES);
      if (rng() < 0.6) fields.publisher = pick(rng, CONF_PUBLISHERS);
      if (rng() < 0.8) fields.pages = makePages(rng);
      if (rng() < 0.4) fields.url = `https://proceedings.example.org/${slug}`;
      break;
    }
    case "thesis": {
      fields.university = pick(rng, UNIVERSITIES);
      fields.thesisType = weighted(rng, THESIS_TYPES);
      if (rng() < 0.5) fields.place = pick(rng, CITIES);
      if (rng() < 0.5) fields.url = `https://repository.example.edu/handle/${serial}`;
      break;
    }
    case "report": {
      fields.institution = pick(rng, INSTITUTIONS);
      if (rng() < 0.8) fields.reportNumber = `TR-${year}-${String(between(rng, 1, 999)).padStart(3, "0")}`;
      if (rng() < 0.3) fields.reportType = pick(rng, REPORT_TYPES);
      if (rng() < 0.4) fields.place = pick(rng, CITIES);
      if (rng() < 0.6) fields.url = `https://reports.example.org/${slug}`;
      break;
    }
    case "preprint": {
      const repository = weighted(rng, REPOSITORIES);
      fields.repository = repository;
      if (repository === "arXiv") {
        const month = parseDate(date).month ?? between(rng, 1, 12);
        const id = `${year.slice(2)}${pad2(month)}.${String(between(rng, 0, 99_999)).padStart(5, "0")}`;
        fields.archiveID = `arXiv:${id}`;
        fields.url = `https://arxiv.org/abs/${id}`;
      } else if (rng() < 0.7) {
        fields.url = `https://www.${repository.toLowerCase()}.org/content/${serial}`;
      }
      break;
    }
    case "webpage": {
      fields.websiteTitle = pick(rng, WEBSITES);
      if (rng() < 0.2) fields.websiteType = "Blog post";
      fields.url = `https://blog.example.org/${slug}`;
      accessed = true;
      break;
    }
  }
  if (fields.url && rng() < 0.4) accessed = true;
  return { itemType, fields, creators: makeCreators(rng, itemType), accessed };
}

function generateLibrary(rng: Rng, count: number, doiBase: number): GeneratedLibrary {
  const keys = new Set<string>();
  const items: Item[] = [];
  const nativeKeyed: string[] = [];
  const ctx: GenContext = { rng, doiBase, doiNext: 1, serial: doiBase };
  const span = Math.max(10, Math.ceil(count * 1.4));
  for (let index = 0; index < count; index++) {
    const key = newKey(rng, keys);
    const made = makeItem(ctx, weighted(rng, ITEM_TYPES));
    if (index >= 20 && rng() < 0.015) {
      const base = items[between(rng, 0, index - 1)] as Item;
      made.creators = base.creators.map(cloneCreator);
      made.fields.date = base.fields.date ?? "";
      made.fields.title = `${base.fields.title ?? ""}${pick(rng, SUFFIXES)}`;
      made.fields.language = base.fields.language ?? "";
    }
    const version = between(rng, 1, span);
    const modified = START_MS + ((version - 1 + rng() * 0.95) / span) * (END_MS - START_MS);
    const added = rng() < 0.25 ? modified : Math.max(START_MS - 3 * YEAR_MS, modified - rng() * 2 * YEAR_MS);
    const item: Item = {
      key,
      version,
      itemType: made.itemType,
      fields: made.fields,
      creators: made.creators,
      dateAdded: iso(added),
      dateModified: iso(modified),
    };
    if (made.accessed) item.fields.accessDate = item.dateAdded;
    if (rng() < 0.6) nativeKeyed.push(key);
    items.push(item);
  }
  const deleted: Array<{ key: string; version: number }> = [];
  for (let n = 0; n < Math.floor(count * 0.01); n++) deleted.push({ key: newKey(rng, keys), version: between(rng, 1, span) });
  deleted.sort((a, b) => a.version - b.version);
  return { items, version: span + between(rng, 0, 3), nativeKeyed, deleted };
}

function makeLibrary(kind: "user" | "group", groupId: number, bbtId: number, name: string, index: number, gen: GeneratedLibrary): Library {
  return {
    kind,
    groupId,
    bbtId,
    name,
    groupVersion: 3 + index,
    created: iso(Date.UTC(2018 + (index % 6), (2 * index) % 12, 10, 9, 30)),
    local: new Map(gen.items.map((item) => [item.key, item])),
    web: new Map(gen.items.map((item) => [item.key, item])),
    localVersion: gen.version,
    webVersion: gen.version,
    deleted: gen.deleted,
    bbtKeys: new Map(),
    nativeKeyed: new Set(gen.nativeKeyed),
  };
}

function shareDois(libs: Library[], rng: Rng): void {
  const groups = libs.slice(1);
  const user = libs[0];
  if (!user || groups.length === 0) return;
  const donors = [...user.local.values()].filter((item) => item.fields.DOI);
  const usedDonors = new Set<string>();
  const usedTargets = new Set<string>();
  for (let n = 0; n < 3 && usedDonors.size < donors.length; n++) {
    let donor = pick(rng, donors);
    while (usedDonors.has(donor.key)) donor = pick(rng, donors);
    usedDonors.add(donor.key);
    const lib = groups[n % groups.length] as Library;
    const candidates = [...lib.local.values()];
    let target = pick(rng, candidates);
    while (usedTargets.has(`${lib.groupId}:${target.key}`)) target = pick(rng, candidates);
    usedTargets.add(`${lib.groupId}:${target.key}`);
    target.itemType = donor.itemType;
    target.fields = { ...donor.fields, extra: "", accessDate: target.fields.accessDate ?? "" };
    target.creators = donor.creators.map(cloneCreator);
  }
}

function alphaSuffix(value: number): string {
  let n = value;
  let out = "";
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

function disambiguate(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  for (let n = 1; ; n++) {
    const candidate = `${base}${alphaSuffix(n)}`;
    if (!used.has(candidate)) return candidate;
  }
}

function titleWords(title: string): string[] {
  const out: string[] = [];
  for (const word of title.split(/[^\p{L}\p{N}]+/u)) {
    if (!word || BBT_SKIP.has(word.toLowerCase())) continue;
    const ascii = fold(word).replace(/[^A-Za-z0-9]/g, "");
    if (ascii) out.push(ascii);
  }
  return out;
}

function bbtBase(item: Item): string {
  const creators = primaryCreators(item);
  const words = titleWords(item.fields.title ?? "");
  const year = parseDate(item.fields.date ?? "").year ?? "";
  const first = creators[0];
  if (first) {
    const auth = romanize(creatorName(first)) || "anon";
    return `${auth}${words.slice(0, 3).map(capitalize).join("")}${year}`;
  }
  const auth = (words[0] ?? "").toLowerCase() || "anon";
  return `${auth}${words.slice(1, 4).map(capitalize).join("")}${year}`;
}

function assignBbtKeys(lib: Library): void {
  const items = [...lib.local.values()].sort((a, b) =>
    a.dateAdded < b.dateAdded ? -1 : a.dateAdded > b.dateAdded ? 1 : a.key < b.key ? -1 : 1,
  );
  const used = new Set<string>();
  for (const item of items) {
    const key = disambiguate(bbtBase(item), used);
    used.add(key);
    lib.bbtKeys.set(item.key, key);
  }
}

function uniqueBbtKey(lib: Library, item: Item): string {
  const used = new Set<string>();
  for (const key of lib.local.keys()) {
    if (key === item.key) continue;
    const citationKey = lib.bbtKeys.get(key);
    if (citationKey) used.add(citationKey);
  }
  return disambiguate(bbtBase(item), used);
}

function generateWorld(itemCount: number, groupCount: number, seed: number): World {
  const count = Math.max(0, Math.floor(itemCount));
  const libs: Library[] = [makeLibrary("user", 0, 1, "My Library", 0, generateLibrary(mulberry32(seed), count, 0))];
  const groupSize = Math.max(5, Math.round(count * 0.08));
  for (let g = 0; g < Math.max(0, Math.floor(groupCount)); g++) {
    const gen = generateLibrary(mulberry32(mixSeed(seed, g + 1)), groupSize, (g + 1) * 1_000_000);
    libs.push(makeLibrary("group", 2_000_001 + g, g + 2, GROUP_NAMES[g] ?? `Group ${g + 1}`, g, gen));
  }
  shareDois(libs, mulberry32(mixSeed(seed, 9_999)));
  const finish = mulberry32(mixSeed(seed, 7_777));
  let lastStamp = 0;
  for (const lib of libs) {
    assignBbtKeys(lib);
    for (const item of lib.local.values()) {
      if (finish() < 0.02) {
        item.fields.extra = `Citation Key: ${lib.bbtKeys.get(item.key) ?? ""}\nPMID: ${between(finish, 10_000_000, 39_999_999)}`;
      }
      lastStamp = Math.max(lastStamp, Date.parse(item.dateModified));
    }
  }
  return { libs, lastStamp, keyRng: mulberry32(mixSeed(seed, 31_337)) };
}

function texEscape(value: string): string {
  return value.replace(/[\\{}&%$#_~^]/g, (ch) => TEX_ESCAPES[ch] ?? ch);
}

function texNames(creators: MockCreator[]): string {
  return creators
    .map((c) => {
      if (c.name !== undefined) return `{${texEscape(c.name)}}`;
      const last = texEscape(c.lastName ?? "");
      return c.firstName ? `${last}, ${texEscape(c.firstName)}` : last;
    })
    .join(" and ");
}

function texPages(pages: string | undefined): string {
  return (pages ?? "").replace(/\s*[-‒–—―−]+\s*/g, "--");
}

function zoteroProtect(value: string): string {
  return value.replace(/([^\s\-}([]+[A-Z][^\s,]*)/g, "{$1}");
}

function bbtTitle(title: string): string {
  const out: string[] = [];
  let run: string[] = [];
  const flush = (trail: string): void => {
    if (run.length > 0) {
      out.push(`{{${run.join(" ")}}}${trail}`);
      run = [];
    }
  };
  texEscape(title)
    .split(" ")
    .forEach((token, index) => {
      const match = /^(.*?)([:;,.!?]*)$/.exec(token);
      const core = match?.[1] ?? token;
      const trail = match?.[2] ?? "";
      if (index > 0 && /\p{Lu}/u.test(core)) {
        run.push(core);
        if (trail) flush(trail);
        return;
      }
      flush("");
      out.push(token);
    });
  flush("");
  return out.join(" ");
}

function langid(language: string | undefined): string | undefined {
  return LANGIDS[(language ?? "").toLowerCase()];
}

function accessDay(value: string | undefined): string | undefined {
  return /^\d{4}-\d{2}-\d{2}/.exec(value ?? "")?.[0];
}

function thesisKind(thesisType: string, bib: boolean): string {
  if (/master/i.test(thesisType)) return bib ? "mathesis" : "mastersthesis";
  return "phdthesis";
}

function entryType(item: Item, bib: boolean): string {
  switch (item.itemType) {
    case "journalArticle":
      return "article";
    case "book":
      return "book";
    case "bookSection":
      return "incollection";
    case "conferencePaper":
      return "inproceedings";
    case "thesis":
      return bib ? "thesis" : thesisKind(item.fields.thesisType ?? "", false);
    case "report":
      return bib ? "report" : "techreport";
    case "preprint":
    case "webpage":
      return bib ? "online" : "misc";
    default:
      return "misc";
  }
}

function collector(fields: BibField[]): (name: string, value: string | undefined, kind?: FieldKind) => void {
  return (name, value, kind = "text") => {
    if (value) fields.push({ name, value, kind });
  };
}

function fieldValue(field: BibField): string {
  if (field.kind === "raw") return field.value;
  return `{${field.kind === "text" ? texEscape(field.value) : field.value}}`;
}

function isEditor(creator: MockCreator): boolean {
  return creator.creatorType === "editor";
}

function isAuthor(creator: MockCreator): boolean {
  return creator.creatorType !== "editor";
}

function splitExtra(extra: string): { citationKey: string; note: string } {
  let citationKey = "";
  const rest: string[] = [];
  for (const line of extra.split("\n")) {
    const match = /^\s*citation key:\s*(\S+)\s*$/i.exec(line);
    if (match && !citationKey) citationKey = match[1] ?? "";
    else if (line.trim()) rest.push(line);
  }
  return { citationKey, note: rest.join("\n") };
}

function zoteroBaseKey(item: Item): string {
  const creator = item.creators[0];
  const author = creator ? creatorName(creator).toLowerCase().replace(/ /g, "_").replace(/,/g, "") : "";
  const word = (item.fields.title ?? "").toLowerCase().replace(ZOTERO_BANNED, "").split(/\s+/)[0] ?? "";
  const year = parseDate(item.fields.date ?? "").year ?? "????";
  return fold(`${author}_${word}_${year}`).toLowerCase().replace(ZOTERO_KEY_CLEAN, "");
}

function zoteroEntry(item: Item, flavor: Flavor, key: string, note: string): string {
  const f = item.fields;
  const bib = flavor === "biblatex";
  const fields: BibField[] = [];
  const put = collector(fields);
  const date = parseDate(f.date ?? "");
  put(bib ? "location" : "address", f.place);
  if (bib && item.itemType === "thesis") put("type", thesisKind(f.thesisType ?? "", true));
  if (item.itemType === "report") put("type", f.reportType);
  put("title", zoteroProtect(texEscape(f.title ?? "")), "tex");
  put("volume", f.volume);
  put("isbn", f.ISBN);
  put("url", f.url, "verbatim");
  put("doi", f.DOI, "verbatim");
  put("abstract", f.abstractNote);
  if (bib) put("langid", langid(f.language));
  else put("language", f.language);
  put("number", f.issue || f.reportNumber);
  put("urldate", accessDay(f.accessDate));
  if (item.itemType === "journalArticle") put(bib ? "journaltitle" : "journal", f.publicationTitle);
  const book = f.bookTitle || f.proceedingsTitle;
  if (book) put("booktitle", zoteroProtect(texEscape(book)), "tex");
  if (bib) put("eventtitle", f.conferenceName);
  if (item.itemType === "thesis") put(bib ? "institution" : "school", f.university);
  put("institution", f.institution);
  put("publisher", f.publisher || f.repository);
  put("author", texNames(item.creators.filter(isAuthor)), "tex");
  put("editor", texNames(item.creators.filter(isEditor)), "tex");
  put("note", note);
  if (bib) {
    put("date", isoDate(date));
  } else {
    if (date.month) put("month", MONTHS[date.month - 1], "raw");
    put("year", date.year);
  }
  put("pages", texPages(f.pages), "verbatim");
  if (!bib && item.itemType === "webpage") put("howpublished", f.url, "verbatim");
  const arxiv = /^arxiv:(.+)$/i.exec(f.archiveID ?? "");
  if (bib && item.itemType === "preprint" && arxiv) {
    put("eprinttype", "arXiv");
    put("eprint", arxiv[1], "verbatim");
  }
  return `@${entryType(item, bib)}{${key},${fields.map((field) => `\n\t${field.name} = ${fieldValue(field)},`).join("")}\n}`;
}

function bbtEntry(item: Item, flavor: Flavor, key: string): string {
  const f = item.fields;
  const bib = flavor === "biblatex";
  const fields: BibField[] = [];
  const put = collector(fields);
  const date = parseDate(f.date ?? "");
  put("title", bbtTitle(f.title ?? ""), "tex");
  put("author", texNames(item.creators.filter(isAuthor)), "tex");
  put("editor", texNames(item.creators.filter(isEditor)), "tex");
  if (bib) {
    put("date", isoDate(date));
  } else {
    put("year", date.year);
    if (date.month) put("month", MONTHS[date.month - 1], "raw");
  }
  if (item.itemType === "journalArticle") put(bib ? "journaltitle" : "journal", f.publicationTitle);
  const book = f.bookTitle || f.proceedingsTitle;
  if (book) put("booktitle", bbtTitle(book), "tex");
  if (bib) put("eventtitle", f.conferenceName);
  if (item.itemType === "thesis") {
    if (bib) put("type", thesisKind(f.thesisType ?? "", true));
    put(bib ? "institution" : "school", f.university);
  }
  put("institution", f.institution);
  put("publisher", f.publisher);
  put(bib ? "location" : "address", f.place);
  put("volume", f.volume);
  put("number", f.issue || f.reportNumber);
  put("pages", texPages(f.pages), "verbatim");
  put("isbn", f.ISBN);
  put("doi", f.DOI, "verbatim");
  if (item.itemType === "preprint") {
    const arxiv = /^arxiv:(.+)$/i.exec(f.archiveID ?? "");
    if (arxiv) {
      put("eprint", arxiv[1], "verbatim");
      put(bib ? "eprinttype" : "archiveprefix", "arXiv");
    } else {
      put(bib ? "organization" : "publisher", f.repository);
      put("number", f.archiveID);
    }
  }
  if (item.itemType === "webpage") put(bib ? "organization" : "howpublished", f.websiteTitle);
  put("url", f.url, "verbatim");
  put("urldate", accessDay(f.accessDate));
  put("abstract", f.abstractNote);
  if (bib) put("langid", langid(f.language));
  return `@${entryType(item, bib)}{${key},\n${fields.map((field) => `  ${field.name} = ${fieldValue(field)}`).join(",\n")}\n}`;
}

function nativeKeyFor(lib: Library, item: Item, nativeOn: boolean): string {
  return nativeOn && lib.nativeKeyed.has(item.key) ? (lib.bbtKeys.get(item.key) ?? "") : "";
}

function zoteroExport(lib: Library, items: Item[], flavor: Flavor, nativeOn: boolean): string {
  const used = new Set<string>();
  const entries = items.map((item) => {
    const extra = splitExtra(item.fields.extra ?? "");
    const base = nativeKeyFor(lib, item, nativeOn) || extra.citationKey || zoteroBaseKey(item);
    let key = base;
    for (let n = 1; used.has(key); n++) key = `${base}-${n}`;
    used.add(key);
    return zoteroEntry(item, flavor, key, extra.note);
  });
  return `\n${entries.join("\n\n")}`;
}

function itemData(lib: Library, item: Item, view: ViewContext): Record<string, unknown> {
  const data: Record<string, unknown> = {
    key: item.key,
    version: item.version,
    itemType: item.itemType,
    title: item.fields.title ?? "",
    creators: item.creators.map(cloneCreator),
  };
  for (const name of SCHEMA[item.itemType] ?? []) {
    const value = item.fields[name] ?? "";
    if (view.full || value !== "") data[name] = value;
  }
  for (const [name, value] of Object.entries(item.fields)) {
    if (name in data || value === "") continue;
    data[name] = value;
  }
  if (view.nativeOn) data.citationKey = nativeKeyFor(lib, item, true);
  data.tags = [];
  data.collections = [];
  data.relations = {};
  data.dateAdded = item.dateAdded;
  data.dateModified = item.dateModified;
  return data;
}

function libraryJson(lib: Library, view: ViewContext): Record<string, unknown> {
  return {
    type: lib.kind,
    id: lib.kind === "user" ? view.userId : lib.groupId,
    name: lib.kind === "user" ? view.username : lib.name,
    links: {},
  };
}

function itemJson(lib: Library, item: Item, view: ViewContext, includeData: boolean): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  const summary = creatorSummary(item);
  if (summary) meta.creatorSummary = summary;
  const parsed = isoDate(parseDate(item.fields.date ?? ""));
  if (parsed) meta.parsedDate = parsed;
  meta.numChildren = 0;
  const out: Record<string, unknown> = {
    key: item.key,
    version: item.version,
    library: libraryJson(lib, view),
    links: {},
    meta,
  };
  if (includeData) out.data = itemData(lib, item, view);
  return out;
}

function matchesQuery(item: Item, q: string): boolean {
  if ((item.fields.title ?? "").toLowerCase().includes(q)) return true;
  return item.creators.some((c) => creatorName(c).toLowerCase().includes(q));
}

function filterItems(items: Iterable<Item>, query: ItemQuery): Item[] {
  const include: string[] = [];
  const exclude: string[] = [];
  for (const raw of query.itemTypes) {
    for (const part of raw.split(/\s*(?:\|\||&&)\s*/)) {
      const type = part.trim();
      if (!type) continue;
      if (type.startsWith("-")) exclude.push(type.slice(1));
      else include.push(type);
    }
  }
  const out: Item[] = [];
  for (const item of items) {
    if (query.since !== null && item.version <= query.since) continue;
    if (query.itemKeys && !query.itemKeys.has(item.key)) continue;
    if (include.length > 0 && !include.includes(item.itemType)) continue;
    if (exclude.includes(item.itemType)) continue;
    if (query.q && !matchesQuery(item, query.q)) continue;
    out.push(item);
  }
  return out;
}

function sortTitle(item: Item): string {
  return (item.fields.title ?? "").replace(/^[^\p{L}\p{N}]+/u, "");
}

function sortItems(items: Item[], sort: string, direction: "asc" | "desc"): void {
  const sign = direction === "asc" ? 1 : -1;
  items.sort((a, b) => {
    let cmp: number;
    if (sort === "title") {
      cmp = collator.compare(sortTitle(a), sortTitle(b));
    } else {
      const x = sort === "dateAdded" ? a.dateAdded : a.dateModified;
      const y = sort === "dateAdded" ? b.dateAdded : b.dateModified;
      cmp = x < y ? -1 : x > y ? 1 : 0;
    }
    if (cmp === 0) cmp = a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    return cmp * sign;
  });
}

function toInt(value: string | null): number | null {
  return value !== null && /^-?\d+$/.test(value.trim()) ? Number(value.trim()) : null;
}

function text(status: number, body: string, contentType = "text/plain"): Reply {
  return { status, headers: { "Content-Type": contentType }, body };
}

function json(status: number, value: unknown, headers: Record<string, string> = {}): Reply {
  return { status, headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(value) };
}

function parseItemQuery(params: URLSearchParams, web: boolean): ItemQuery | Reply {
  const format = params.get("format") ?? "json";
  if (!FORMATS.has(format)) return text(400, `Invalid 'format' value '${format}'`);
  const sort = params.get("sort") ?? "dateModified";
  if (!SORTS.has(sort)) return text(400, `Invalid 'sort' value '${sort}'`);
  const directionParam = params.get("direction");
  const direction = directionParam === "asc" || directionParam === "desc" ? directionParam : sort === "title" ? "asc" : "desc";
  const keyList = params.get("itemKey");
  const itemKeys = keyList ? keyList.split(",").map((k) => k.trim()).filter(Boolean) : null;
  if (web && itemKeys && itemKeys.length > 50) return text(400, "Cannot specify more than 50 item keys");
  let limit = toInt(params.get("limit"));
  if (limit !== null && limit < 1) limit = null;
  if (web && format !== "keys" && format !== "versions") limit = Math.min(limit ?? 25, 100);
  const include = (params.get("include") ?? "data").split(",").map((part) => part.trim());
  return {
    format,
    includeData: include.includes("data"),
    includeExports: include.filter((part): part is Flavor => part === "bibtex" || part === "biblatex"),
    limit,
    start: Math.max(0, toInt(params.get("start")) ?? 0),
    sort,
    direction,
    since: toInt(params.get("since")),
    itemKeys: itemKeys ? new Set(itemKeys) : null,
    itemTypes: params.getAll("itemType"),
    q: params.get("q")?.trim().toLowerCase() || null,
  };
}

function linkHeader(base: string, pathname: string, params: URLSearchParams, start: number, limit: number, total: number): string {
  const make = (at: number): string => {
    const next = new URLSearchParams(params);
    next.set("limit", String(limit));
    if (at > 0) next.set("start", String(at));
    else next.delete("start");
    return `<${base}${pathname}?${next.toString()}>`;
  };
  const links: string[] = [];
  if (start > 0) {
    links.push(`${make(0)}; rel="first"`);
    links.push(`${make(Math.max(0, start - limit))}; rel="prev"`);
  }
  if (start + limit < total) {
    links.push(`${make(start + limit)}; rel="next"`);
    links.push(`${make(Math.floor((total - 1) / limit) * limit)}; rel="last"`);
  }
  return links.join(", ");
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toList(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeVersion(value: string): string {
  return ZOTERO_VERSIONS[value.trim()] ?? value.trim();
}

function normalizePath(pathname: string): string {
  return pathname
    .replace(/\/users\/\d+/, "/users/:userID")
    .replace(/\/groups\/\d+/, "/groups/:groupID")
    .replace(/\/items\/(?!top$|trash$)[^/]+/, "/items/:itemKey")
    .replace(/\/keys\/(?!current$)[^/]+/, "/keys/:key");
}

function toCreator(value: unknown): MockCreator {
  if (!isRecord(value)) throw new Error("creators must be objects");
  const creatorType = typeof value.creatorType === "string" ? value.creatorType : "author";
  if (typeof value.name === "string") return { creatorType, name: value.name };
  return { creatorType, firstName: String(value.firstName ?? ""), lastName: String(value.lastName ?? "") };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function allowCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Expose-Headers", "*");
}

function send(res: ServerResponse, reply: Reply): void {
  res.writeHead(reply.status, reply.headers);
  res.end(reply.status === 204 || reply.status === 304 ? undefined : reply.body);
}

function serve(handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>): Server {
  return createServer((req, res) => {
    handler(req, res).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(error instanceof Error ? error.message : String(error));
    });
  });
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

class RpcError extends Error {
  code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

function rpcParam(params: unknown, index: number, names: string[]): unknown {
  if (Array.isArray(params)) return params[index];
  if (isRecord(params)) {
    for (const name of names) if (name in params) return params[name];
  }
  return undefined;
}

function emptyResults(): MockZoteroResults {
  return { added: [], edited: [], bbtKeys: [], deleted: [], synced: [] };
}

export async function startMockZotero(options: MockZoteroOptions = {}): Promise<MockZotero> {
  const settings: Settings = {
    running: options.running ?? true,
    localApi: options.localApi ?? true,
    bbt: options.bbt ?? true,
    zoteroVersion: normalizeVersion(options.zoteroVersion ?? "7"),
    nativeCitationKeys: options.nativeCitationKeys ?? null,
    apiKey: options.apiKey ?? "MOCKKEY0123456789abcdefABCD",
    userId: options.userId ?? 475425,
    username: options.username ?? "mockuser",
    backoff: options.backoff ?? null,
    rateLimit: Math.max(0, Math.floor(options.rateLimit ?? 0)),
    webDown: options.webDown ?? false,
    revokeKey: options.revokeKey ?? false,
  };
  let generation = { items: options.items ?? 1000, groups: options.groups ?? 2, seed: options.seed ?? 42 };
  let world = generateWorld(generation.items, generation.groups, generation.seed);
  const requestLog: MockRequestLogEntry[] = [];
  const requestCounts = new Map<string, number>();
  let localServer: Server | null = null;
  let localPort = 0;
  let webBase = "";
  let queue: Promise<unknown> = Promise.resolve();

  const isV10 = (): boolean => settings.zoteroVersion.startsWith("10");
  const nativeOn = (): boolean => settings.nativeCitationKeys ?? Number.parseInt(settings.zoteroVersion, 10) >= 8;
  const viewContext = (full: boolean): ViewContext => ({
    full,
    nativeOn: nativeOn(),
    userId: settings.userId,
    username: settings.username,
  });
  const userLibrary = (): Library => world.libs[0] as Library;
  const findGroup = (id: string): Library | undefined =>
    world.libs.find((lib) => lib.kind === "group" && String(lib.groupId) === id);
  const libraryRef = (lib: Library): MockLibraryRef => (lib.kind === "user" ? "user" : lib.groupId);
  const bbtLibraryName = (lib: Library): string => (lib.kind === "user" ? "My Library" : lib.name);
  const bump = (key: string): void => {
    requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);
  };

  const logRequest = (server: "local" | "web", req: IncomingMessage, url: URL, res: ServerResponse): MockRequestLogEntry => {
    const h = req.headers;
    const entry: MockRequestLogEntry = {
      server,
      method: req.method ?? "GET",
      path: `${url.pathname}${url.search}`,
      status: null,
      headers: {
        "If-Modified-Since-Version": headerValue(h["if-modified-since-version"]),
        "Zotero-API-Key": h["zotero-api-key"] !== undefined || /^bearer\s/i.test(headerValue(h.authorization) ?? "") ? "yes" : "no",
        "User-Agent": headerValue(h["user-agent"]),
        Origin: headerValue(h.origin),
      },
    };
    requestLog.push(entry);
    if (requestLog.length > 200) requestLog.shift();
    bump(`${server} ${entry.method} ${normalizePath(url.pathname)}`);
    res.on("finish", () => {
      entry.status = res.statusCode;
    });
    return entry;
  };

  const groupJson = (lib: Library, web: boolean): Record<string, unknown> => {
    const items = web ? lib.web : lib.local;
    let lastModified = lib.created;
    for (const item of items.values()) if (item.dateModified > lastModified) lastModified = item.dateModified;
    return {
      id: lib.groupId,
      version: lib.groupVersion,
      links: {},
      meta: { created: lib.created, lastModified, numItems: items.size },
      data: {
        id: lib.groupId,
        version: lib.groupVersion,
        name: lib.name,
        owner: settings.userId,
        type: "Private",
        description: "",
        url: "",
        libraryEditing: "members",
        libraryReading: "members",
        fileEditing: "members",
      },
    };
  };

  const groupsReply = (params: URLSearchParams, web: boolean): Reply => {
    const groups = world.libs.filter((lib) => lib.kind === "group");
    const user = userLibrary();
    const headers = {
      "Total-Results": String(groups.length),
      "Last-Modified-Version": String(web ? user.webVersion : user.localVersion),
    };
    if (params.get("format") === "versions") {
      return json(200, Object.fromEntries(groups.map((lib) => [String(lib.groupId), lib.groupVersion])), headers);
    }
    return json(200, groups.map((lib) => groupJson(lib, web)), headers);
  };

  const formatItems = (lib: Library, items: Item[], query: ItemQuery, view: ViewContext, headers: Record<string, string>, single: boolean): Reply => {
    switch (query.format) {
      case "keys":
        return { status: 200, headers: { ...headers, "Content-Type": "text/plain" }, body: items.map((item) => item.key).join("\n") };
      case "versions":
        return json(200, Object.fromEntries(items.map((item) => [item.key, item.version])), headers);
      case "bibtex":
      case "biblatex":
        return {
          status: 200,
          headers: { ...headers, "Content-Type": "application/x-bibtex" },
          body: zoteroExport(lib, items, query.format === "bibtex" ? "bibtex" : "biblatex", view.nativeOn),
        };
      default: {
        const objects = items.map((item) => {
          const object = itemJson(lib, item, view, query.includeData);
          for (const flavor of query.includeExports) object[flavor] = zoteroExport(lib, [item], flavor, view.nativeOn);
          return object;
        });
        return json(200, single ? objects[0] : objects, headers);
      }
    }
  };

  const itemsReply = (web: boolean, lib: Library, rest: string[], url: URL, req: IncomingMessage): Reply => {
    if (rest[0] !== "items" || rest.length > 2) return text(404, web ? "Not found" : "No endpoint found");
    const query = parseItemQuery(url.searchParams, web);
    if ("status" in query) return query;
    const source = web ? lib.web : lib.local;
    const libraryVersion = web ? lib.webVersion : lib.localVersion;
    const sinceHeader = headerValue(req.headers["if-modified-since-version"]);
    const sinceVersion = sinceHeader !== null && /^\d+$/.test(sinceHeader.trim()) ? Number(sinceHeader.trim()) : null;
    const view = viewContext(web);
    const sub = rest[1];
    if (sub !== undefined && sub !== "top" && sub !== "trash") {
      const item = source.get(sub);
      if (!item) return text(404, "Not found");
      const headers = { "Last-Modified-Version": String(item.version) };
      if (sinceVersion !== null && item.version <= sinceVersion) return { status: 304, headers, body: "" };
      return formatItems(lib, [item], query, view, headers, true);
    }
    const headers: Record<string, string> = { "Last-Modified-Version": String(libraryVersion) };
    if (sinceVersion !== null && libraryVersion <= sinceVersion) return { status: 304, headers, body: "" };
    const matched = sub === "trash" ? [] : filterItems(source.values(), query);
    sortItems(matched, query.sort, query.direction);
    const end = query.limit === null ? matched.length : query.start + query.limit;
    const page = matched.slice(query.start, end);
    headers["Total-Results"] = String(matched.length);
    if (web && query.limit !== null) {
      const link = linkHeader(webBase, url.pathname, url.searchParams, query.start, query.limit, matched.length);
      if (link) headers.Link = link;
    }
    return formatItems(lib, page, query, view, headers, false);
  };

  const deletedReply = (lib: Library, params: URLSearchParams): Reply => {
    const since = toInt(params.get("since")) ?? 0;
    const items = lib.deleted.filter((entry) => entry.version > since).map((entry) => entry.key);
    return json(
      200,
      { collections: [], searches: [], items, tags: [], settings: [] },
      { "Last-Modified-Version": String(lib.webVersion) },
    );
  };

  const localApiReply = (url: URL, req: IncomingMessage): Reply => {
    const parts = url.pathname.split("/").filter(Boolean).slice(1);
    if (parts.length === 0) return text(200, "Nothing to see here.");
    const [scope, id] = parts;
    if (scope === "users" && id !== undefined) {
      if (id !== "0" && id !== String(settings.userId)) {
        return text(400, `Only data for the logged-in user is available locally -- use userID 0 or ${settings.userId}`);
      }
      const rest = parts.slice(2);
      if (rest.length === 1 && rest[0] === "groups") return groupsReply(url.searchParams, false);
      return itemsReply(false, userLibrary(), rest, url, req);
    }
    if (scope === "groups" && id !== undefined) {
      const lib = findGroup(id);
      if (!lib) return text(404, "Not found");
      return itemsReply(false, lib, parts.slice(2), url, req);
    }
    return text(404, "No endpoint found");
  };

  const resolveBbtLibrary = (value: unknown): Library | undefined => {
    if (value === undefined || value === null) return userLibrary();
    if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))) {
      const n = Number(value);
      return world.libs.find((lib) => lib.bbtId === n) ?? world.libs.find((lib) => lib.kind === "group" && lib.groupId === n);
    }
    if (typeof value === "string") {
      const lower = value.toLowerCase();
      return world.libs.find((lib) => bbtLibraryName(lib).toLowerCase() === lower);
    }
    return undefined;
  };

  const rpcCall = (method: string, params: unknown): unknown => {
    switch (method) {
      case "api.ready":
        return { betterbibtex: BBT_VERSION, zotero: settings.zoteroVersion };
      case "user.groups":
        return world.libs.map((lib) => ({ id: lib.bbtId, name: bbtLibraryName(lib), collections: null }));
      case "item.citationkey": {
        const keys = rpcParam(params, 0, ["item_keys", "itemKeys", "keys"]);
        if (!Array.isArray(keys)) throw new RpcError(-32602, "Invalid params");
        const result: Record<string, string | null> = {};
        for (const raw of keys) {
          const input = String(raw);
          const match = /^(\d+):(.+)$/.exec(input);
          const lib = match ? world.libs.find((l) => l.bbtId === Number(match[1])) : userLibrary();
          const itemKey = match ? (match[2] ?? "") : input;
          result[input] = lib && lib.local.has(itemKey) ? (lib.bbtKeys.get(itemKey) ?? null) : null;
        }
        return result;
      }
      case "item.export": {
        const rawKeys = rpcParam(params, 0, ["citekeys", "citationKeys"]);
        const citekeys = typeof rawKeys === "string" ? [rawKeys] : rawKeys;
        if (!Array.isArray(citekeys)) throw new RpcError(-32602, "Invalid params");
        const translator = String(rpcParam(params, 1, ["translator"]) ?? "");
        const flavor = TRANSLATORS[translator.toLowerCase()];
        if (!flavor) throw new RpcError(-32602, `Unknown translator '${translator}'`);
        const libraryParam = rpcParam(params, 2, ["libraryID", "library"]);
        const lib = resolveBbtLibrary(libraryParam);
        if (!lib) throw new RpcError(-32602, `library '${String(libraryParam)}' not found`);
        const wanted = [...new Set(citekeys.map(String))];
        const byKey = new Map<string, Item>();
        const wantedSet = new Set(wanted);
        for (const [itemKey, item] of lib.local) {
          const citationKey = lib.bbtKeys.get(itemKey);
          if (citationKey && wantedSet.has(citationKey) && !byKey.has(citationKey)) byKey.set(citationKey, item);
        }
        const missing = wanted.filter((key) => !byKey.has(key));
        if (missing.length > 0) throw new RpcError(-32602, `not found: ${missing.join(", ")}`);
        const entries = wanted.map((key) => bbtEntry(byKey.get(key) as Item, flavor, key));
        return entries.length > 0 ? `${entries.join("\n\n")}\n` : "";
      }
      default:
        throw new RpcError(-32601, `Method not found: ${method}`);
    }
  };

  const rpcSingle = (request: unknown, entry: MockRequestLogEntry): Record<string, unknown> => {
    if (!isRecord(request) || typeof request.method !== "string") {
      const id = isRecord(request) ? (request.id ?? null) : null;
      return { jsonrpc: "2.0", error: { code: -32600, message: "Invalid Request" }, id };
    }
    const id = request.id ?? null;
    entry.rpcMethod = entry.rpcMethod ? `${entry.rpcMethod},${request.method}` : request.method;
    bump(`local RPC ${request.method}`);
    try {
      return { jsonrpc: "2.0", result: rpcCall(request.method, request.params), id };
    } catch (error) {
      if (error instanceof RpcError) return { jsonrpc: "2.0", error: { code: error.code, message: error.message }, id };
      throw error;
    }
  };

  const rpcReply = (body: string, entry: MockRequestLogEntry): Reply => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return json(200, { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
    }
    if (Array.isArray(parsed)) return json(200, parsed.map((request) => rpcSingle(request, entry)));
    return json(200, rpcSingle(parsed, entry));
  };

  const browserRequest = (req: IncomingMessage): boolean =>
    (headerValue(req.headers["user-agent"]) ?? "").startsWith("Mozilla/") || req.headers.origin !== undefined;

  const handleLocal = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    allowCors(res);
    res.setHeader("Zotero-API-Version", "3");
    res.setHeader("Zotero-Schema-Version", "29");
    res.setHeader("X-Zotero-Version", settings.zoteroVersion);
    if (isV10()) res.setHeader("Zotero-Server-ID", `mockserver-${generation.seed}`);
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const entry = logRequest("local", req, url, res);
    if (req.method === "OPTIONS") return send(res, { status: 204, headers: {}, body: "" });
    if (isV10()) {
      const host = (headerValue(req.headers.host) ?? "").toLowerCase().replace(/:\d+$/, "");
      if (host !== "127.0.0.1" && host !== "localhost") return send(res, text(400, "Invalid Host header"));
    }
    const path = url.pathname;
    if (path === "/connector/ping") {
      if (req.method === "POST") return send(res, json(200, { prefs: { automaticSnapshots: true, downloadAssociatedFiles: true } }));
      return send(res, text(200, "Zotero is running", "text/html"));
    }
    if (path === "/better-bibtex/json-rpc") {
      if (!settings.bbt) return send(res, text(404, "No endpoint found"));
      if (isV10() && browserRequest(req)) return send(res, text(403, "Request not allowed"));
      if (req.method !== "POST") return send(res, text(400, "Endpoint does not support method"));
      return send(res, rpcReply(await readBody(req), entry));
    }
    if (path === "/api" || path.startsWith("/api/")) {
      if (isV10() && browserRequest(req)) return send(res, text(403, "Request not allowed"));
      if (!settings.localApi) return send(res, text(403, "Local API is not enabled"));
      if (req.method !== "GET") return send(res, text(400, "Endpoint does not support method"));
      return send(res, localApiReply(url, req));
    }
    return send(res, text(404, "No endpoint found"));
  };

  const webRoute = (req: IncomingMessage, url: URL): Reply => {
    if (settings.webDown) return { status: 503, headers: { "Content-Type": "text/plain", "Retry-After": "2" }, body: "Service Unavailable" };
    if (settings.rateLimit > 0) {
      settings.rateLimit -= 1;
      return { status: 429, headers: { "Content-Type": "text/plain", "Retry-After": "1" }, body: "Too Many Requests" };
    }
    if (req.method !== "GET") return text(405, "Method Not Allowed");
    const bearer = /^bearer\s+(.+)$/i.exec(headerValue(req.headers.authorization) ?? "");
    const presented = headerValue(req.headers["zotero-api-key"]) ?? bearer?.[1]?.trim() ?? url.searchParams.get("key");
    if (settings.revokeKey || presented !== settings.apiKey) return text(403, "Forbidden");
    const parts = url.pathname.split("/").filter(Boolean);
    const [scope, id] = parts;
    const rest = parts.slice(2);
    if (scope === "keys" && parts.length === 2) {
      if (id !== "current" && id !== settings.apiKey) return text(404, "Key not found");
      return json(200, {
        key: settings.apiKey,
        userID: settings.userId,
        username: settings.username,
        displayName: "Mock User",
        access: {
          user: { library: true, files: true, notes: true, write: false },
          groups: { all: { library: true, write: false } },
        },
      });
    }
    if (scope === "users" && id !== undefined) {
      if (id !== String(settings.userId)) return text(403, "Forbidden");
      if (rest.length === 1 && rest[0] === "groups") return groupsReply(url.searchParams, true);
      if (rest.length === 1 && rest[0] === "deleted") return deletedReply(userLibrary(), url.searchParams);
      return itemsReply(true, userLibrary(), rest, url, req);
    }
    if (scope === "groups" && id !== undefined) {
      const lib = findGroup(id);
      if (!lib) return text(404, "Not found");
      if (rest.length === 1 && rest[0] === "deleted") return deletedReply(lib, url.searchParams);
      return itemsReply(true, lib, rest, url, req);
    }
    return text(404, "Not found");
  };

  const handleWeb = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    allowCors(res);
    res.setHeader("Zotero-API-Version", "3");
    res.setHeader("Zotero-Schema-Version", "29");
    if (settings.backoff !== null) res.setHeader("Backoff", String(settings.backoff));
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    logRequest("web", req, url, res);
    if (req.method === "OPTIONS") return send(res, { status: 204, headers: {}, body: "" });
    send(res, webRoute(req, url));
  };

  const resolveLibrary = (ref: unknown): Library => {
    if (ref === undefined || ref === "user" || ref === 0 || ref === "0") return userLibrary();
    const lib = typeof ref === "number" || typeof ref === "string" ? findGroup(String(ref)) : undefined;
    if (!lib) throw new Error(`Unknown library '${String(ref)}'`);
    return lib;
  };

  const stamp = (): string => {
    const ms = Math.max(Math.floor(Date.now() / 1000) * 1000, world.lastStamp + 1000);
    world.lastStamp = ms;
    return iso(ms);
  };

  const nextVersion = (lib: Library): number => Math.max(lib.localVersion, lib.webVersion) + 1;

  const commitItem = (lib: Library, item: Item, sync: boolean): void => {
    if (sync || isV10()) {
      const version = nextVersion(lib);
      item.version = version;
      lib.localVersion = version;
      if (sync) {
        lib.webVersion = version;
        lib.web.set(item.key, item);
      }
    }
    lib.local.set(item.key, item);
  };

  const applyFields = (lib: Library, item: Item, fields: Record<string, unknown>): void => {
    for (const [name, value] of Object.entries(fields)) {
      if (name === "creators") {
        if (!Array.isArray(value)) throw new Error("creators must be an array");
        item.creators = value.map(toCreator);
      } else if (name === "itemType") {
        item.itemType = String(value);
      } else if (name === "citationKey") {
        lib.bbtKeys.set(item.key, String(value));
        lib.nativeKeyed.add(item.key);
      } else if (!RESERVED_FIELDS.has(name)) {
        item.fields[name] = value === null || value === undefined ? "" : String(value);
      }
    }
  };

  const requireItem = (lib: Library, key: unknown): Item => {
    const item = lib.local.get(String(key ?? ""));
    if (!item) throw new Error(`Unknown item '${String(key)}' in library '${String(libraryRef(lib))}'`);
    return item;
  };

  const addItem = (patch: unknown, results: MockZoteroResults): void => {
    if (!isRecord(patch)) throw new Error("addItem expects an object");
    const lib = resolveLibrary(patch.library);
    const data = isRecord(patch.item) ? patch.item : {};
    const taken = new Set<string>([...lib.local.keys(), ...lib.web.keys(), ...lib.deleted.map((entry) => entry.key)]);
    const now = stamp();
    const item: Item = {
      key: newKey(world.keyRng, taken),
      version: 0,
      itemType: "journalArticle",
      fields: {},
      creators: [],
      dateAdded: now,
      dateModified: now,
    };
    applyFields(lib, item, data);
    commitItem(lib, item, patch.sync !== false);
    if (!lib.bbtKeys.has(item.key)) lib.bbtKeys.set(item.key, uniqueBbtKey(lib, item));
    lib.nativeKeyed.add(item.key);
    results.added.push({
      library: libraryRef(lib),
      key: item.key,
      citationKey: lib.bbtKeys.get(item.key) ?? "",
      version: item.version,
      dateModified: item.dateModified,
    });
  };

  const editItem = (patch: unknown, results: MockZoteroResults): void => {
    if (!isRecord(patch)) throw new Error("editItem expects an object");
    const lib = resolveLibrary(patch.library);
    const current = requireItem(lib, patch.key);
    if (!isRecord(patch.fields)) throw new Error("editItem.fields must be an object");
    const next = cloneItem(current);
    applyFields(lib, next, patch.fields);
    next.dateModified = stamp();
    commitItem(lib, next, patch.sync !== false);
    if (patch.regenerateKey === true) lib.bbtKeys.set(next.key, uniqueBbtKey(lib, next));
    results.edited.push({
      library: libraryRef(lib),
      key: next.key,
      citationKey: lib.bbtKeys.get(next.key) ?? "",
      version: next.version,
      dateModified: next.dateModified,
    });
  };

  const setBbtKey = (patch: unknown, results: MockZoteroResults): void => {
    if (!isRecord(patch)) throw new Error("setBbtKey expects an object");
    const lib = resolveLibrary(patch.library);
    const item = requireItem(lib, patch.key);
    const citationKey = String(patch.citationKey ?? "").trim();
    if (!citationKey) throw new Error("setBbtKey.citationKey must be a non-empty string");
    lib.bbtKeys.set(item.key, citationKey);
    results.bbtKeys.push({ library: libraryRef(lib), key: item.key, citationKey });
  };

  const deleteItem = (patch: unknown, results: MockZoteroResults): void => {
    if (!isRecord(patch)) throw new Error("deleteItem expects an object");
    const lib = resolveLibrary(patch.library);
    const item = requireItem(lib, patch.key);
    const sync = patch.sync !== false;
    lib.local.delete(item.key);
    let version = lib.localVersion;
    if (sync || isV10()) {
      version = nextVersion(lib);
      lib.localVersion = version;
    }
    if (sync) {
      lib.webVersion = version;
      if (lib.web.delete(item.key)) lib.deleted.push({ key: item.key, version });
    }
    results.deleted.push({ library: libraryRef(lib), key: item.key, version });
  };

  const syncAll = (results: MockZoteroResults): void => {
    for (const lib of world.libs) {
      const pending: Item[] = [];
      for (const [key, item] of lib.local) if (lib.web.get(key) !== item) pending.push(item);
      const removed = [...lib.web.keys()].filter((key) => !lib.local.has(key));
      if (pending.length === 0 && removed.length === 0) continue;
      const version = nextVersion(lib);
      for (const item of pending) {
        item.version = version;
        lib.web.set(item.key, item);
      }
      for (const key of removed) {
        lib.web.delete(key);
        lib.deleted.push({ key, version });
      }
      lib.localVersion = version;
      lib.webVersion = version;
      results.synced.push({ library: libraryRef(lib), version, items: pending.length, deletions: removed.length });
    }
  };

  const setRunning = async (on: boolean): Promise<void> => {
    if (on && !localServer) {
      const server = serve(handleLocal);
      await listen(server, localPort);
      localServer = server;
    } else if (!on && localServer) {
      const server = localServer;
      localServer = null;
      await closeServer(server);
    }
    settings.running = on;
  };

  const asNumber = (value: unknown, name: string): number => {
    const n = Number(value);
    if (typeof value === "boolean" || !Number.isFinite(n)) throw new Error(`${name} must be a number`);
    return n;
  };

  const applyPatch = async (patch: unknown): Promise<MockZoteroResults> => {
    if (!isRecord(patch)) throw new Error("Control body must be a JSON object");
    const unknownKeys = Object.keys(patch).filter((key) => !PATCH_KEYS.has(key));
    if (unknownKeys.length > 0) throw new Error(`Unknown control keys: ${unknownKeys.join(", ")}`);
    const results = emptyResults();
    if (patch.clearLog === true) {
      requestLog.length = 0;
      requestCounts.clear();
    }
    if (patch.reset !== undefined && patch.reset !== false) {
      const reset = isRecord(patch.reset) ? patch.reset : {};
      generation = {
        items: reset.items === undefined ? generation.items : asNumber(reset.items, "reset.items"),
        groups: reset.groups === undefined ? generation.groups : asNumber(reset.groups, "reset.groups"),
        seed: reset.seed === undefined ? generation.seed : asNumber(reset.seed, "reset.seed"),
      };
      world = generateWorld(generation.items, generation.groups, generation.seed);
    }
    if ("zoteroVersion" in patch) settings.zoteroVersion = normalizeVersion(String(patch.zoteroVersion));
    if ("nativeCitationKeys" in patch) {
      settings.nativeCitationKeys = patch.nativeCitationKeys === null ? null : patch.nativeCitationKeys === true;
    }
    if ("localApi" in patch) settings.localApi = patch.localApi === true;
    if ("bbt" in patch) settings.bbt = patch.bbt === true;
    if ("webDown" in patch) settings.webDown = patch.webDown === true;
    if ("revokeKey" in patch) settings.revokeKey = patch.revokeKey === true;
    if ("apiKey" in patch) settings.apiKey = String(patch.apiKey);
    if ("username" in patch) settings.username = String(patch.username);
    if ("userId" in patch) settings.userId = Math.floor(asNumber(patch.userId, "userId"));
    if ("backoff" in patch) settings.backoff = patch.backoff === null ? null : asNumber(patch.backoff, "backoff");
    if ("rateLimit" in patch) settings.rateLimit = Math.max(0, Math.floor(asNumber(patch.rateLimit, "rateLimit")));
    for (const item of toList(patch.addItem)) addItem(item, results);
    for (const item of toList(patch.editItem)) editItem(item, results);
    for (const item of toList(patch.setBbtKey)) setBbtKey(item, results);
    for (const item of toList(patch.deleteItem)) deleteItem(item, results);
    if (patch.syncNow === true) syncAll(results);
    if ("running" in patch) await setRunning(patch.running === true);
    return results;
  };

  const setState = (patch: MockZoteroPatch | unknown): Promise<MockZoteroResults> => {
    const run = queue.then(() => applyPatch(patch));
    queue = run.catch(() => undefined);
    return run;
  };

  const summary = (): MockZoteroStateSummary => {
    const itemCount: Record<string, number> = {};
    const libraryVersion: Record<string, number> = {};
    const webItemCount: Record<string, number> = {};
    const webLibraryVersion: Record<string, number> = {};
    const libraries: MockLibrarySummary[] = world.libs.map((lib) => {
      const label = String(libraryRef(lib));
      let unsynced = 0;
      for (const [key, item] of lib.local) if (lib.web.get(key) !== item) unsynced += 1;
      for (const key of lib.web.keys()) if (!lib.local.has(key)) unsynced += 1;
      itemCount[label] = lib.local.size;
      libraryVersion[label] = lib.localVersion;
      webItemCount[label] = lib.web.size;
      webLibraryVersion[label] = lib.webVersion;
      return {
        library: libraryRef(lib),
        name: lib.kind === "user" ? "My Library" : lib.name,
        bbtLibraryID: lib.bbtId,
        itemCount: lib.local.size,
        libraryVersion: lib.localVersion,
        webItemCount: lib.web.size,
        webLibraryVersion: lib.webVersion,
        deletedCount: lib.deleted.length,
        unsynced,
      };
    });
    return {
      running: settings.running,
      localApi: settings.localApi,
      bbt: settings.bbt,
      zoteroVersion: settings.zoteroVersion,
      nativeCitationKeys: nativeOn(),
      apiKey: settings.apiKey,
      userId: settings.userId,
      username: settings.username,
      backoff: settings.backoff,
      rateLimit: settings.rateLimit,
      webDown: settings.webDown,
      revokeKey: settings.revokeKey,
      seed: generation.seed,
      itemCount,
      libraryVersion,
      webItemCount,
      webLibraryVersion,
      libraries,
      requestCounts: Object.fromEntries(requestCounts),
      requests: requestLog.map((entry) => ({ ...entry, headers: { ...entry.headers } })),
    };
  };

  const handleControl = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    allowCors(res);
    if (req.method === "OPTIONS") return send(res, { status: 204, headers: {}, body: "" });
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/__state") return send(res, json(200, summary()));
    if (req.method === "POST" && url.pathname === "/__control") {
      const body = await readBody(req);
      let patch: unknown;
      try {
        patch = body.trim() ? JSON.parse(body) : {};
      } catch {
        return send(res, json(400, { ok: false, error: "Invalid JSON" }));
      }
      try {
        const results = await setState(patch);
        return send(res, json(200, { ok: true, results }));
      } catch (error) {
        return send(res, json(400, { ok: false, error: error instanceof Error ? error.message : String(error) }));
      }
    }
    return send(res, text(404, "Not found"));
  };

  const firstLocal = serve(handleLocal);
  localPort = await listen(firstLocal, options.localPort ?? 0);
  localServer = firstLocal;
  const webServer = serve(handleWeb);
  const webPort = await listen(webServer, options.webPort ?? 0);
  webBase = `http://127.0.0.1:${webPort}`;
  const controlServer = serve(handleControl);
  const controlPort = await listen(controlServer, options.controlPort ?? 0);
  if (!settings.running) {
    localServer = null;
    await closeServer(firstLocal);
  }

  return {
    local: `http://127.0.0.1:${localPort}`,
    web: webBase,
    control: `http://127.0.0.1:${controlPort}`,
    setState,
    state: summary,
    close: async () => {
      const servers = [webServer, controlServer];
      if (localServer) servers.push(localServer);
      localServer = null;
      await Promise.all(servers.map(closeServer));
    },
  };
}

function parseCliArgs(args: string[]): MockZoteroOptions {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument '${arg}'`);
    const eq = arg.indexOf("=");
    if (eq > 0) {
      values.set(arg.slice(2, eq), arg.slice(eq + 1));
    } else {
      values.set(arg.slice(2), args[i + 1] ?? "");
      i += 1;
    }
  }
  const allowed = new Set(["items", "groups", "seed", "zotero", "local-port", "web-port", "control-port"]);
  for (const name of values.keys()) if (!allowed.has(name)) throw new Error(`Unknown option --${name}`);
  const num = (name: string): number | undefined => {
    const value = values.get(name);
    if (value === undefined) return undefined;
    const n = Number(value);
    if (value.trim() === "" || !Number.isFinite(n)) throw new Error(`--${name} expects a number`);
    return n;
  };
  return {
    items: num("items"),
    groups: num("groups"),
    seed: num("seed"),
    zoteroVersion: values.get("zotero"),
    localPort: num("local-port"),
    webPort: num("web-port"),
    controlPort: num("control-port"),
  };
}

async function runCli(args: string[]): Promise<void> {
  const mock = await startMockZotero(parseCliArgs(args));
  process.stdout.write(`${JSON.stringify({ local: mock.local, web: mock.web, control: mock.control })}\n`);
  const stop = (): void => {
    void mock.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

if (/mock-zotero-server\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  });
}
