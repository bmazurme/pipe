import { SVGProps } from 'react';

/**
 * Builds an avatar-styled icon carrying a single initial.
 *
 * Returned as a factory rather than a component with a `letter` prop because
 * the navigation sidebar's `icon` slot takes icon *data* (a component), not a
 * rendered element. Everything is drawn in `currentColor`, so the sidebar's
 * hover/active tinting applies to it like any other icon.
 */
export function createInitialIcon(letter: string) {
  function InitialIcon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2" opacity="0.75" />
        <text
          x="8"
          y="8"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="system-ui, -apple-system, sans-serif"
          fontSize="8"
          fontWeight="600"
          fill="currentColor"
        >
          {letter}
        </text>
      </svg>
    );
  }

  return InitialIcon;
}

/** First letter of an email/username, uppercased; '?' while the user loads. */
export function getInitial(name: string | undefined | null): string {
  return name?.trim().charAt(0).toUpperCase() || '?';
}
