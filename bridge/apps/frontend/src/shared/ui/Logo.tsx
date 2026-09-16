import { SVGProps, useId } from 'react';

export function LogoMark(props: SVGProps<SVGSVGElement>) {
  const gradientId = useId();

  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <rect width="32" height="32" rx="9" fill={`url(#${gradientId})`} />
      <text
        x="16"
        y="16"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize="15"
        fontWeight="700"
        fill="#fff"
      >
        N
      </text>
      <defs>
        <linearGradient
          id={gradientId}
          x1="0"
          y1="0"
          x2="32"
          y2="32"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#8C7AFF" />
          <stop offset="1" stopColor="#5B4BC4" />
        </linearGradient>
      </defs>
    </svg>
  );
}
