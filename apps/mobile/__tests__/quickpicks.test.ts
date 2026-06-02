import { quickPicks } from "../src/lib/quickpicks";

// A fixed reference instant (morning, so "Tonight" is still ahead).
const morning = new Date(2026, 5, 3, 10, 0, 0);
const lateNight = new Date(2026, 5, 3, 22, 0, 0);

describe("quickPicks", () => {
  it("includes Tonight only before the evening hour", () => {
    expect(quickPicks(morning).some((p) => p.key === "tonight")).toBe(true);
    expect(quickPicks(lateNight).some((p) => p.key === "tonight")).toBe(false);
  });

  it("tomorrow is the next calendar day in the evening", () => {
    const tom = quickPicks(morning).find((p) => p.key === "tomorrow");
    expect(tom?.date).toBe("2026-06-04");
    expect(tom?.time).toBe("19:00");
  });

  it("both Saturday picks land on a Saturday and share a date", () => {
    const picks = quickPicks(morning);
    const sat = picks.find((p) => p.key === "sat");
    const eve = picks.find((p) => p.key === "sat-eve");
    expect(new Date(`${sat?.date}T00:00:00`).getDay()).toBe(6);
    expect(sat?.date).toBe(eve?.date);
    expect(sat?.time).toBe("13:00");
    expect(eve?.time).toBe("19:00");
  });

  it("next week is seven days out", () => {
    expect(quickPicks(morning).find((p) => p.key === "next-week")?.date).toBe("2026-06-10");
  });

  it("produces picker-compatible YYYY-MM-DD / HH:mm strings", () => {
    for (const p of quickPicks(morning)) {
      expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.time).toMatch(/^\d{2}:\d{2}$/);
    }
  });
});
