import { vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// jsdom polyfill: Element.scrollTo（jsdom 未实现）
if (!Element.prototype.scrollTo) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Element.prototype.scrollTo = vi.fn() as any;
}

// jsdom polyfill: Element.scrollIntoView（jsdom 未实现）
if (!Element.prototype.scrollIntoView) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Element.prototype.scrollIntoView = vi.fn() as any;
}
