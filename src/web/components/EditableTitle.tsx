import { useRef, useState } from "react";
import { setTaskTitle } from "../api";

/**
 * Inline task-title editor. Click the title → input; Enter/blur saves, Escape
 * cancels, a blank title cancels. `onEditingChange` lets a draggable parent (the
 * Week chip) disable dragging while editing. Stops click/mousedown propagation so
 * it doesn't trip surrounding card handlers.
 */
export function EditableTitle({
  id,
  title,
  onChange,
  className,
  onEditingChange,
}: {
  id: number;
  title: string;
  onChange: () => void;
  className?: string;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const cancelRef = useRef(false);

  function begin(e: React.MouseEvent) {
    e.stopPropagation();
    setValue(title);
    cancelRef.current = false;
    setEditing(true);
    onEditingChange?.(true);
  }
  function finish() {
    setEditing(false);
    onEditingChange?.(false);
  }
  async function commit() {
    if (cancelRef.current) {
      cancelRef.current = false;
      finish();
      return;
    }
    const t = value.trim();
    finish();
    if (!t || t === title) return;
    try {
      await setTaskTitle(id, t);
      onChange();
    } catch {
      /* leave the title as-is on failure */
    }
  }

  if (editing) {
    return (
      <input
        className={`title-edit-input ${className ?? ""}`}
        value={value}
        autoFocus
        draggable={false}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            cancelRef.current = true;
            e.currentTarget.blur();
          }
        }}
      />
    );
  }
  return (
    <span className={`title-edit ${className ?? ""}`} title="Click to rename" onClick={begin}>
      {title}
    </span>
  );
}
