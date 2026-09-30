/**
 * A card's headline figure, in the top right of its title: the heaviest day,
 * the busiest hour, the app on top.
 *
 * The chart below it shows the shape; this names the one number a reader
 * would otherwise have to find by hovering. `detail` is WHICH day, hour or
 * app, and sits beside the label rather than under the figure, so the callout
 * is two lines and stays clear of the plot area.
 */
export function Callout({
  label, detail, value,
}: {
  label: string;
  detail?: string;
  value: string;
}) {
  return (
    <div className="callout">
      <div className="callout-head">
        <span className="callout-label">{label}</span>
        {detail && <span className="callout-date">{detail}</span>}
      </div>
      <div className="callout-value">{value}</div>
    </div>
  );
}
