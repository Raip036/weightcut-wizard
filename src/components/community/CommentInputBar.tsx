/**
 * CommentInputBar — sticky comment input shown under the top polaroid.
 *
 * Submits on Enter or send-button tap; auto-clears on success. While the
 * mutation is in flight the send button disables to prevent duplicate
 * posts. Parent owns the mutation (handed in via `onSubmit`) so this
 * component stays presentational.
 */
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";

interface CommentInputBarProps {
  onSubmit: (text: string) => Promise<void> | void;
  placeholder?: string;
}

export function CommentInputBar({
  onSubmit,
  placeholder = "Add a comment…",
}: CommentInputBarProps) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const send = async () => {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(text.trim());
      setText("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-card/30 border border-border/30">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") send();
        }}
        placeholder={placeholder}
        maxLength={500}
        className="flex-1 bg-transparent text-body-sm placeholder:text-muted-foreground/60 outline-none"
      />
      <button
        type="button"
        onClick={send}
        disabled={!text.trim() || submitting}
        className="h-8 w-8 rounded-full flex items-center justify-center bg-primary text-primary-foreground active:scale-95 transition-transform disabled:opacity-40 disabled:active:scale-100"
        aria-label="Send comment"
      >
        <Icon name="arrowUpOutline" size={14} />
      </button>
    </div>
  );
}
