import { describe, expect, it } from "vitest";
import {
  INITIAL_DESKTOP_NAVIGATION,
  isTaskInProgress,
  reduceDesktopNavigation,
  type DesktopNavigation,
} from "./desktopNavigation";

describe("desktop navigation", () => {
  it("moves the import workflow through progress into the new session", () => {
    const importing = reduceDesktopNavigation(INITIAL_DESKTOP_NAVIGATION, { type: "open", view: "import" });
    const progress = reduceDesktopNavigation(importing, { type: "startImport" });
    const completed = reduceDesktopNavigation(progress, { type: "importCompleted", sessionId: "session-42" });

    expect(progress).toMatchObject({ view: "importProgress", sessionId: null });
    expect(isTaskInProgress(progress.view)).toBe(true);
    expect(completed).toEqual({
      view: "session",
      sessionId: "session-42",
      sessionSection: "overview",
    });
  });

  it("returns a failed import to its form instead of silently sending users home", () => {
    const failed = reduceDesktopNavigation(
      { view: "importProgress", sessionId: null, sessionSection: "overview" },
      { type: "importFailed" },
    );

    expect(failed).toEqual({ view: "import", sessionId: null, sessionSection: "overview" });
  });

  it("keeps the selected session while moving between its atomic work areas", () => {
    const overview: DesktopNavigation = {
      view: "session",
      sessionId: "session-7",
      sessionSection: "overview",
    };
    const deliverables = reduceDesktopNavigation(overview, {
      type: "showSessionSection",
      section: "deliverables",
    });
    const generate = reduceDesktopNavigation(deliverables, {
      type: "showSessionSection",
      section: "generate",
    });

    expect(deliverables).toMatchObject({ sessionId: "session-7", sessionSection: "deliverables" });
    expect(generate).toMatchObject({ sessionId: "session-7", sessionSection: "generate" });
  });

  it("opens library sessions at an overview and keeps delivery completion contextual", () => {
    const opened = reduceDesktopNavigation(INITIAL_DESKTOP_NAVIGATION, {
      type: "openSession",
      sessionId: "saved-session",
      section: "deliverables",
    });
    const generating = reduceDesktopNavigation(opened, {
      type: "startDelivery",
      sessionId: "saved-session",
    });
    const completed = reduceDesktopNavigation(generating, {
      type: "deliveryCompleted",
      sessionId: "saved-session",
    });

    expect(opened.sessionSection).toBe("deliverables");
    expect(generating).toMatchObject({ view: "session", sessionSection: "generate" });
    expect(completed).toEqual(generating);
  });

  it("does not invent a session section without an active session", () => {
    const next = reduceDesktopNavigation(INITIAL_DESKTOP_NAVIGATION, {
      type: "showSessionSection",
      section: "deliverables",
    });

    expect(next).toEqual(INITIAL_DESKTOP_NAVIGATION);
  });
});
