"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { cn } from "@/lib/utils";

export interface ChartSpec {
  chart_type: string;
  x_field?: string | null;
  y_field?: string | null;
  title?: string | null;
}

interface DataChartProps {
  results: Record<string, unknown>[];
  chartSpec: ChartSpec;
  /** Optional table to render when chart_type is "table" or as fallback */
  renderTable?: () => React.ReactNode;
  /** Use fixed hex colors so exports (e.g. PDF) capture reliably */
  colorPalette?: "theme" | "export";
  /** Override chart viewport height (default h-[320px]; PDF export uses a taller capture). */
  chartHeightClassName?: string;
}

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/** Solid colors for PDF / html2canvas (CSS variables often rasterize poorly). */
const EXPORT_CHART_COLORS = ["#2563eb", "#16a34a", "#d97706", "#7c3aed", "#db2777"];

function formatLabel(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}

export function DataChart({
  results,
  chartSpec,
  renderTable,
  colorPalette = "theme",
  chartHeightClassName = "h-[320px]",
}: DataChartProps) {
  const palette = colorPalette === "export" ? EXPORT_CHART_COLORS : CHART_COLORS;
  const hWrap = chartHeightClassName;
  const axisTickFill = colorPalette === "export" ? "#64748b" : "var(--muted-foreground)";
  const gridStroke = colorPalette === "export" ? "#e2e8f0" : "var(--border)";
  const cardBg = colorPalette === "export" ? "#ffffff" : "var(--card)";
  const cardBorder = colorPalette === "export" ? "#e2e8f0" : "var(--border)";
  const chartType = (chartSpec.chart_type || "table").toLowerCase();
  const xField = chartSpec.x_field ?? "";
  const yField = chartSpec.y_field ?? "";
  const columns = results.length > 0 ? Object.keys(results[0]) : [];
  const hasX = xField && columns.includes(xField);
  const hasY = yField && columns.includes(yField);

  // Fallback: use first two columns if spec fields are missing
  const xKey = hasX ? xField : columns[0] ?? "";
  const yKey = hasY ? yField : columns[1] ?? columns[0] ?? "";

  if (chartType === "table" || !xKey || results.length === 0) {
    return renderTable ? <>{renderTable()}</> : null;
  }

  // For bar/line: data is the results array directly
  const chartData = results.map((row) => ({ ...row }));

  if (chartType === "bar") {
    return (
      <div className={cn(hWrap, "w-full")}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis
              dataKey={xKey}
              tickFormatter={formatLabel}
              className="text-xs"
              tick={{ fill: axisTickFill }}
            />
            <YAxis
              tickFormatter={formatLabel}
              className="text-xs"
              tick={{ fill: axisTickFill }}
            />
            <Tooltip
              formatter={(value: unknown) => [formatLabel(value), yKey]}
              labelFormatter={formatLabel}
              contentStyle={{
                backgroundColor: cardBg,
                border: `1px solid ${cardBorder}`,
                borderRadius: 8,
              }}
            />
            <Bar dataKey={yKey} fill={palette[0]} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (chartType === "line" || chartType === "area") {
    const ChartComponent = chartType === "area" ? AreaChart : LineChart;
    return (
      <div className={cn(hWrap, "w-full")}>
        <ResponsiveContainer width="100%" height="100%">
          <ChartComponent data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
            <defs>
              <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={palette[0]} stopOpacity={0.3} />
                <stop offset="100%" stopColor={palette[0]} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} opacity={0.5} />
            <XAxis
              dataKey={xKey}
              tickFormatter={formatLabel}
              className="text-xs"
              tick={{ fill: axisTickFill }}
            />
            <YAxis
              tickFormatter={formatLabel}
              className="text-xs"
              tick={{ fill: axisTickFill }}
            />
            <Tooltip
              formatter={(value: unknown) => [formatLabel(value), yKey]}
              labelFormatter={formatLabel}
              contentStyle={{
                backgroundColor: cardBg,
                border: `1px solid ${cardBorder}`,
                borderRadius: 8,
              }}
            />
            {chartType === "area" ? (
              <Area
                type="monotone"
                dataKey={yKey}
                stroke={palette[0]}
                strokeWidth={2}
                fill="url(#areaGradient)"
              />
            ) : (
              <Line
                type="monotone"
                dataKey={yKey}
                stroke={palette[0]}
                strokeWidth={2}
                dot={{ fill: palette[0] }}
              />
            )}
          </ChartComponent>
        </ResponsiveContainer>
      </div>
    );
  }

  if (chartType === "pie") {
    // Pie: x_field = category/label, y_field = value. Limit to 8 slices.
    const pieData = results.slice(0, 8).map((row) => ({
      name: formatLabel(row[xKey]),
      value: Number(row[yKey]) || 0,
    }));

    if (pieData.every((d) => d.value === 0)) {
      return renderTable ? <>{renderTable()}</> : null;
    }

    return (
      <div className={cn(hWrap, "w-full")}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={100}
              label={({ name, percent }) =>
                `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
              }
            >
              {pieData.map((_, index) => (
                <Cell key={index} fill={palette[index % palette.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: unknown) => formatLabel(value)}
              contentStyle={{
                backgroundColor: cardBg,
                border: `1px solid ${cardBorder}`,
                borderRadius: 8,
              }}
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Unknown chart type: fallback to table
  return renderTable ? <>{renderTable()}</> : null;
}
