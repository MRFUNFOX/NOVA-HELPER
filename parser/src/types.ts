/**
 * Формат базы NOVA HELPER. Эти же типы использует программа (UI и поиск),
 * поэтому любое изменение формата — повод поднять SCHEMA_VERSION.
 */
export const SCHEMA_VERSION = 1;

export type Scope = 'project' | 'server';

/** Вид узла дерева. Порядок — от крупного к мелкому. */
export type NodeKind =
  | 'heading'   // заголовок без номера («Общая часть», «Игровые аккаунты»)
  | 'section'   // «Раздел I», «1. Общее положение»
  | 'chapter'   // «Глава VI»
  | 'article'   // «Статья 6.1»
  | 'point'     // «2.7», «2.7.1»
  | 'part';     // «ч. 1»

export type AnnotationType = 'note' | 'exception' | 'explanation' | 'clarification';

export interface Annotation {
  type: AnnotationType;
  /** Текст в лёгком Markdown: абзацы и списки «- ». */
  text: string;
}

export type PunishmentKind =
  | 'ban' | 'permaban' | 'blacklist' | 'warn' | 'jail' | 'mute' | 'kick'
  | 'confiscation' | 'reset' | 'prison' | 'fine' | 'dismissal' | 'reprimand' | 'other';

export interface Punishment {
  /** Как написано на форуме — всегда показываем именно это. */
  raw: string;
  /** Распознанные виды наказаний (для бейджей и фильтров). */
  kinds: PunishmentKind[];
  /** true, если возможна перманентная блокировка или ЧС проекта. */
  severe: boolean;
}

export interface ImageRef {
  /** Исходный адрес на форуме. */
  src: string;
  alt?: string;
  width?: number;
  height?: number;
  /** Заполняется пайплайном после перезаливки на свой хостинг. */
  sha256?: string;
  url?: string;
}

export type AmendmentStatus =
  /** Основной текст на форуме уже совпадает с поправкой. */
  | 'applied'
  /** Основной текст устарел и не редактировался после поправки — показываем редакцию из поправки. */
  | 'overlaid'
  /**
   * Основной текст совпадает со «было», но его редактировали уже после поправки:
   * неясно, забыли обновить или откатили. Показываем обе редакции и предупреждаем разработчика.
   */
  | 'unmerged'
  /** Поправка ещё не вступила в силу. */
  | 'pending'
  /** Основной текст не совпадает ни с «было», ни со «стало» — нужна проверка. */
  | 'conflict'
  /** Поправка описана словами, автоматически применить нельзя. */
  | 'notice';

export interface Amendment {
  status: AmendmentStatus;
  /** ISO-дата вступления в силу (или публикации поправки). */
  effectiveAt?: string;
  postId: string;
  postUrl: string;
  /** Текст пункта до поправки (как в основном сообщении). */
  previousText?: string;
  /** Текст пункта по поправке. */
  newText?: string;
  /** Для 'notice': что сказано в поправке. */
  message?: string;
}

export interface RuleNode {
  /** Стабильный ID: `<docId>#<путь номеров>` — не меняется при правке текста. */
  id: string;
  kind: NodeKind;
  /** Номер как на форуме: «2.7.1», «6.1», «1», «VI». Пусто у заголовков. */
  number?: string;
  /** Слово перед номером для показа: «Часть», «Раздел», «Подраздел». */
  label?: string;
  /** Основной текст пункта (лёгкий Markdown). */
  text: string;
  /** Уровни розыска ★ (УК): [мин, макс]. */
  wanted?: [number, number];
  /** Юрисдикция из квадратных скобок: «Федеральная/Региональная». */
  jurisdiction?: string;
  punishments: Punishment[];
  annotations: Annotation[];
  images: ImageRef[];
  amendments: Amendment[];
  children: RuleNode[];
  /** sha256 содержимого узла без детей — для поиска изменений. */
  hash: string;
}

export interface RuleDocument {
  /** `project/<threadId>` или `server/<slug>/<threadId>`. */
  id: string;
  scope: Scope;
  serverId?: string;
  /** Раздел форума, откуда документ: «Общие правила», «Законодательная база». */
  category: string;
  title: string;
  threadId: number;
  sourceUrl: string;
  /** Когда опубликовано первое сообщение. */
  publishedAt?: string;
  fetchedAt: string;
  locked: boolean;
  children: RuleNode[];
  /** Поправки, которые не удалось привязать к конкретному пункту. */
  looseAmendments: Amendment[];
  stats: { nodes: number; punishments: number; images: number };
  hash: string;
}

export interface ServerInfo {
  id: string;
  name: string;
  forumUrl: string;
  lawBaseUrl?: string;
  /** Сервер не найден на форуме при последних прогонах (см. validate). */
  missingRuns?: number;
  archived?: boolean;
}
