import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadTextFile } from "./download.js";

afterEach(() => {
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("downloadTextFile", () => {
  it("clicks a temporary link named for the file, then removes it and frees the URL", () => {
    vi.useFakeTimers();
    const created: Blob[] = [];
    const revoked: string[] = [];
    Object.assign(URL, {
      createObjectURL: (blob: Blob) => {
        created.push(blob);
        return "blob:test/1";
      },
      revokeObjectURL: (url: string) => revoked.push(url),
    });
    const clicked: { name: string; href: string; attached: boolean }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ name: this.download, href: this.href, attached: this.isConnected });
    });

    downloadTextFile("data.json", '{"a":1}');

    expect(clicked).toEqual([{ name: "data.json", href: "blob:test/1", attached: true }]);
    expect(created[0]?.type).toBe("application/json");
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revoked).toEqual([]);
    vi.runAllTimers();
    expect(revoked).toEqual(["blob:test/1"]);
  });
});
