/**
 * InlineCommentsPreview: shows up to 2 of the most recent comments
 * inline under the polaroid, with a "See all N comments →" link to
 * open the full comments sheet.
 *
 * Renders nothing when the post has zero comments. Parent provides the
 * preview slice (typically the latest 2) plus the total count so the
 * "See all" link can show the accurate number.
 */
interface CommentRow {
  id: string;
  author: string;
  text: string;
  createdAt: number;
}

interface InlineCommentsPreviewProps {
  comments: CommentRow[];
  totalCount: number;
  onSeeAll: () => void;
}

export function InlineCommentsPreview({
  comments,
  totalCount,
  onSeeAll,
}: InlineCommentsPreviewProps) {
  if (totalCount === 0) return null;
  return (
    <div className="space-y-1.5 px-1">
      {comments.slice(0, 2).map((c) => (
        <div key={c.id} className="text-[12px] leading-snug">
          <span className="font-semibold text-foreground">{c.author}</span>
          <span className="ml-1.5 text-muted-foreground">{c.text}</span>
        </div>
      ))}
      {totalCount > 2 && (
        <button
          type="button"
          onClick={onSeeAll}
          className="text-[11px] text-muted-foreground/80 active:text-foreground transition-colors"
        >
          See all {totalCount} comments →
        </button>
      )}
    </div>
  );
}
