import React from 'react';
import { ButtonVariant, getButtonStyles } from './styles';

interface MenuItem {
  label: string;
  onClick: () => Promise<void> | void;
}

interface SplitButtonProps {
  children: React.ReactNode;
  variant?: ButtonVariant;
  onClick: () => Promise<void> | void;
  /** Dropdown items. Ignored when onChevronClick is provided. */
  menuItems?: MenuItem[];
  /** When set, the chevron becomes a plain toggle (no dropdown): it calls this
      instead of opening the menu. Used by the answer buttons to open a shared
      offset row below the button row instead of a per-button popover. */
  onChevronClick?: () => void;
  /** Marks the chevron as "its panel is open" (glyph flips to ▲). */
  chevronActive?: boolean;
  style?: React.CSSProperties;
  title?: string;
  /** Greys out and blocks the main click area (the chevron stays usable). */
  disabled?: boolean;
  /** FORK (2026-10-10): fixed TOTAL width — main part plus chevron. Used by the queue's
   *  answer row so every main button matches Dismiss (95 px); the chevron narrows to
   *  COMPACT_CHEVRON_WIDTH and the main part's side padding shrinks so the longest
   *  sublabel ("invalid rotation", 70 px at 10 px) still fits on one line. */
  width?: number;
  /** FORK (2026-11-14): a share of a flex row instead of a fixed width — the phone answer
   *  row, where every button takes a share of one line. The main part grows by this
   *  factor, as a plain button with the same `flex-grow` would, and the chevron
   *  (ROW_SHARE_CHEVRON_WIDTH) is added to it. Ignored when `width` is set. */
  rowShare?: number;
}

// Chevron segment widths: the default, the compact one used with a fixed `width`, and the
// one used with `rowShare` (a touch target, so wider than the compact one).
const CHEVRON_WIDTH = 28;
const COMPACT_CHEVRON_WIDTH = 18;
const ROW_SHARE_CHEVRON_WIDTH = 22;

export function SplitButton({
  children,
  variant = 'secondary',
  onClick,
  menuItems = [],
  onChevronClick,
  chevronActive = false,
  style,
  title,
  disabled = false,
  width,
  rowShare,
}: SplitButtonProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (menuOpen) {
      // Force iframe to expand to fit the absolute dropdown
      document.body.style.paddingBottom = '150px';
    } else {
      document.body.style.paddingBottom = '';
      return; 
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
      document.body.style.paddingBottom = '';
    };
  }, [menuOpen]);

  const styles = getButtonStyles();
  const variantStyles =
    variant === 'primary'
      ? styles.primary
      : variant === 'danger'
        ? styles.danger
        : styles.secondary;

  const hoverBg =
    variant === 'primary'
      ? 'var(--rn-clr-button-primary-bg, #3b82f6)'
      : 'var(--rn-clr-background-secondary)';

  const chevronBorderColor =
    style?.backgroundColor
      ? 'rgba(255,255,255,0.3)'
      : variant === 'primary'
      ? 'rgba(255,255,255,0.3)'
      : 'var(--rn-clr-border-primary)';

  const shared = !width && rowShare !== undefined; // FORK (2026-11-14): see `rowShare`
  const chevronWidth = width ? COMPACT_CHEVRON_WIDTH : shared ? ROW_SHARE_CHEVRON_WIDTH : CHEVRON_WIDTH;
  const fixedMain: React.CSSProperties = width
    ? { minWidth: 0, width: width - COMPACT_CHEVRON_WIDTH, paddingLeft: 3, paddingRight: 3, whiteSpace: 'nowrap' }
    : shared
      ? { minWidth: 0, width: 'auto', flex: '1 1 0', paddingLeft: 0, paddingRight: 0, whiteSpace: 'nowrap' }
      : {};
  // A share starts from the chevron plus 2 px: a plain button with `flex: n 1 0` and no
  // padding cannot be narrower than its two 1 px borders, so its share starts from 2 px
  // too, and the main part here ends up exactly as wide as that button.
  const containerSize: React.CSSProperties = width
    ? { width }
    : shared
      ? { flex: `${rowShare} 1 ${ROW_SHARE_CHEVRON_WIDTH + 2}px`, minWidth: 0 }
      : {};

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-flex', ...containerSize }}>
      {/* Main button */}
      <button
        onClick={async () => { if (!disabled) await onClick(); }}
        disabled={disabled}
        title={title}
        style={{
          ...styles.base,
          ...variantStyles,
          ...(disabled ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
          borderTopRightRadius: 0,
          borderBottomRightRadius: 0,
          borderRight: 'none',
          ...style,
          ...fixedMain,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = styles.hoverShadow;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = styles.defaultShadow;
        }}
      >
        {children}
      </button>

      {/* Chevron toggle */}
      <button
        onClick={() => (onChevronClick ? onChevronClick() : setMenuOpen((v) => !v))}
        title="More scheduling options"
        style={{
          ...styles.base,
          ...variantStyles,
          borderTopLeftRadius: 0,
          borderBottomLeftRadius: 0,
          borderLeft: `1px solid ${chevronBorderColor}`,
          minWidth: 'unset',
          width: `${chevronWidth}px`,
          padding: '0 4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...style,
          minWidth: 'unset',
          width: `${chevronWidth}px`,
          padding: '0 4px',
          borderTopLeftRadius: 0,
          borderBottomLeftRadius: 0,
          borderLeft: `1px solid ${chevronBorderColor}`,
          ...(shared ? { flexShrink: 0 } : {}), // FORK (2026-11-14): keeps its width in a shared row
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = styles.hoverShadow;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = styles.defaultShadow;
        }}
      >
        <span style={{ fontSize: '10px', lineHeight: 1 }}>{chevronActive ? '▲' : '▼'}</span>
      </button>

      {/* Dropdown menu */}
      {menuOpen && !onChevronClick && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: '4px',
            minWidth: '100%',
            backgroundColor: 'var(--rn-clr-background-primary)',
            border: '1px solid var(--rn-clr-border-primary)',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 100,
            overflow: 'hidden',
          }}
        >
          {menuItems.map((item, i) => (
            <button
              key={i}
              onClick={async () => {
                setMenuOpen(false);
                await item.onClick();
              }}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 14px',
                fontSize: '12px',
                fontWeight: 500,
                color: 'var(--rn-clr-content-primary)',
                backgroundColor: 'transparent',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                whiteSpace: 'nowrap',
                transition: 'background-color 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--rn-clr-background-tertiary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
