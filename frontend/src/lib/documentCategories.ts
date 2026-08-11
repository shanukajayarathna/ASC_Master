/** Every valid Knowledge Base document category — manually kept in sync with the backend's
 *  `Modules/Documents/KnowledgeDocument.cs` `DocumentCategory` enum (same convention as
 *  `roles.ts` mirroring the backend's role names). */
export const DOCUMENT_CATEGORIES = ["Internal", "Authoritative", "Reference", "Training", "External", "Temporary"] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  Internal: "Internal",
  Authoritative: "Authoritative",
  Reference: "Reference",
  Training: "Training",
  External: "External",
  Temporary: "Temporary",
};
