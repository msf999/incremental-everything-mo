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
  menuItems: MenuItem[];
  style?: React.CSSProperties;
  title?: string;
}

export function SplitButton({
  children,
  variant = 'secondary',
  onClick,
  menuItems,
  style,
  title,
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
    variant === 'primary'
      ? 'rgba(255,255,255,0.3)'
      : 'var(--rn-clr-border-primary)';

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-flex' }}>
      {/* Main button */}
      <button
        onClick={async () => { await onClick(); }}
        title={title}
        style={{
          ...styles.base,
          ...variantStyles,
          borderTopRightRadius: 0,
          borderBottomRightRadius: 0,
          borderRight: 'none',
          ...style,
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
        onClick={() => setMenuOpen((v) => !v)}
        title="More scheduling options"
        style={{
          ...styles.base,
          ...variantStyles,
          borderTopLeftRadius: 0,
          borderBottomLeftRadius: 0,
          borderLeft: `1px solid ${chevronBorderColor}`,
          minWidth: 'unset',
          width: '28px',
          padding: '0 4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
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
        <span style={{ fontSize: '10px', lineHeight: 1 }}>▼</span>
      </button>

      {/* Dropdown menu */}
      {menuOpen && (
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
