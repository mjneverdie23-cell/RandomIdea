import { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface SearchOption {
  value: string;
  label: string;
  /** Optional right-aligned hint, e.g. a pick count or a role. */
  hint?: string;
}

interface SearchSelectProps {
  label: string;
  value: string | null;
  options: readonly SearchOption[];
  /**
   * Text to show when `value` isn't among `options` — a pasted team or
   * champion the loaded seasons have never seen. Without it the field would
   * render empty while the draft quietly holds a value.
   */
  valueLabel?: string;
  onChange: (value: string | null) => void;
  placeholder?: string;
  /** Rendered inside the field, before the text — used for champion art. */
  adornment?: React.ReactNode;
  disabled?: boolean;
  /** Visual accent, so a control reads as belonging to one side of the draft. */
  tone?: 'blue' | 'red' | 'neutral';
}

/**
 * A type-to-filter combobox.
 *
 * There are ~170 champions and, with several seasons loaded, over a hundred
 * teams, so a plain `<select>` is unusable and a `<datalist>` can't be styled
 * to show art. This keeps the native keyboard contract — arrows move, Enter
 * commits, Escape reverts — over a list we control.
 */
export function SearchSelect({
  label,
  value,
  options,
  valueLabel,
  onChange,
  placeholder = 'Search…',
  adornment,
  disabled = false,
  tone = 'neutral',
}: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options.slice(0, 200);
    const starts: SearchOption[] = [];
    const contains: SearchOption[] = [];
    for (const option of options) {
      const haystack = option.label.toLowerCase();
      if (haystack.startsWith(needle)) starts.push(option);
      else if (haystack.includes(needle)) contains.push(option);
    }
    return [...starts, ...contains].slice(0, 200);
  }, [options, query]);

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  // Close on any click that lands outside the control.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Keep the active option in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.children[highlight];
    if (node instanceof HTMLElement) node.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const commit = (option: SearchOption) => {
    onChange(option.value);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setHighlight((index) => {
        if (filtered.length === 0) return 0;
        return (index + step + filtered.length) % filtered.length;
      });
      return;
    }
    if (event.key === 'Enter') {
      if (open && filtered[highlight]) {
        event.preventDefault();
        commit(filtered[highlight]!);
      }
      return;
    }
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
        setQuery('');
      }
      return;
    }
    if (event.key === 'Backspace' && query === '' && value !== null) {
      onChange(null);
    }
  };

  return (
    <div className={`search-select tone-${tone}${disabled ? ' is-disabled' : ''}`} ref={rootRef}>
      <div className="search-select-field">
        {adornment && <span className="search-select-art">{adornment}</span>}
        <input
          type="text"
          className="search-select-input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={label}
          disabled={disabled}
          value={open ? query : (selected?.label ?? valueLabel ?? '')}
          placeholder={selected?.label ?? valueLabel ?? placeholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {value !== null && !disabled && (
          <button
            type="button"
            className="search-select-clear"
            aria-label={`Clear ${label}`}
            onClick={() => {
              onChange(null);
              setQuery('');
            }}
          >
            ✕
          </button>
        )}
      </div>

      {open && (
        <ul className="search-select-list" id={listId} role="listbox" ref={listRef}>
          {filtered.length === 0 && <li className="search-select-empty">No match</li>}
          {filtered.map((option, index) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className={`search-select-option${index === highlight ? ' is-active' : ''}${
                option.value === value ? ' is-selected' : ''
              }`}
              onPointerDown={(event) => {
                // Commit before the input's blur can close the list.
                event.preventDefault();
                commit(option);
              }}
              onPointerEnter={() => setHighlight(index)}
            >
              <span className="search-select-label">{option.label}</span>
              {option.hint && <span className="search-select-hint">{option.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
