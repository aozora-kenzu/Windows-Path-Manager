import React from "react";

interface PathHighlightProps {
  raw: string;
  className?: string;
}

export const PathHighlight: React.FC<PathHighlightProps> = ({ raw, className }) => {
  const parts = raw.split(/(%[A-Za-z0-9_() -]+%)/g);
  return (
    <span className={className ? `path-text selectable ${className}` : "path-text selectable"}>
      {parts.map((part, idx) =>
        part.startsWith("%") && part.endsWith("%") && part.length > 2 ? (
          <span key={idx} className="env-token">
            {part}
          </span>
        ) : (
          <React.Fragment key={idx}>{part}</React.Fragment>
        )
      )}
    </span>
  );
};
