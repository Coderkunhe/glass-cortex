import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KVRow } from "@/components/ui/KVRow";

describe("KVRow", () => {
  it("renders label and value", () => {
    render(<KVRow label="Temperature" value="0.7" />);
    expect(screen.getByText("Temperature")).toBeInTheDocument();
    expect(screen.getByText("0.7")).toBeInTheDocument();
  });

  it("applies error styling when error=true", () => {
    render(<KVRow label="Parse" value="FAILED" error />);
    const valueEl = screen.getByText("FAILED");
    expect(valueEl.className).toMatch(/text-danger/);
    expect(valueEl.className).toMatch(/font-semibold/);
  });

  it("does not apply error styling when error=false", () => {
    render(<KVRow label="Parse" value="OK" error={false} />);
    const valueEl = screen.getByText("OK");
    expect(valueEl.className).not.toMatch(/text-danger/);
  });

  it("applies custom className to wrapper", () => {
    render(<KVRow label="X" value="Y" className="my-custom" />);
    const wrapper = screen.getByText("X").closest("div.flex");
    expect(wrapper?.className).toMatch(/my-custom/);
  });

  it("applies data-testid", () => {
    render(<KVRow label="X" value="Y" data-testid="kv-model" />);
    expect(screen.getByTestId("kv-model")).toBeInTheDocument();
  });

  it("renders long value without overflow breakage", () => {
    const long = "a".repeat(200);
    render(<KVRow label="Raw" value={long} />);
    const valueEl = screen.getByText(long);
    expect(valueEl.className).toMatch(/break-all/);
    expect(valueEl.className).toMatch(/max-w-\[55%\]/);
  });

  it("renders empty value", () => {
    render(<KVRow label="Empty" value="" />);
    expect(screen.getByText("Empty")).toBeInTheDocument();
  });

  it("renders numeric value as string", () => {
    render(<KVRow label="Count" value={String(42)} />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });
});
