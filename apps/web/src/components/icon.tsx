import type { IconNode } from "lucide";

// Renders a Lucide icon node as inline SVG. lucide-solid only supports Solid 1, so this
// wraps the framework-free `lucide` package, which is tree-shaken per icon.

function toMarkup(node: IconNode): string {
  return node
    .map(([tag, attrs]) => {
      const attributes = Object.entries(attrs)
        .map(([name, value]) => `${name}="${String(value)}"`)
        .join(" ");
      return `<${tag} ${attributes}/>`;
    })
    .join("");
}

export default function Icon(props: {
  icon: IconNode;
  class?: string;
  size?: number;
  strokeWidth?: number;
  /** Accessible name. Without one the icon is decorative and hidden from assistive tech. */
  label?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={props.size ?? 20}
      height={props.size ?? 20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={props.strokeWidth ?? 1.75}
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`shrink-0 ${props.class ?? ""}`}
      role={props.label ? "img" : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : "true"}
      innerHTML={toMarkup(props.icon)}
    />
  );
}
