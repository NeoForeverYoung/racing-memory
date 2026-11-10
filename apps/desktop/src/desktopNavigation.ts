export type DesktopView =
  | "dashboard"
  | "create"
  | "import"
  | "capture"
  | "library"
  | "settings"
  | "importProgress"
  | "session";

export type SessionSection = "overview" | "deliverables" | "generate";

export type DesktopNavigation = {
  view: DesktopView;
  sessionId: string | null;
  sessionSection: SessionSection;
};

export type NavigationEvent =
  | { type: "open"; view: Exclude<DesktopView, "session" | "importProgress"> }
  | { type: "openSession"; sessionId: string; section?: SessionSection }
  | { type: "startImport" }
  | { type: "importCompleted"; sessionId: string }
  | { type: "importFailed" }
  | { type: "startDelivery"; sessionId: string }
  | { type: "deliveryCompleted"; sessionId: string }
  | { type: "showSessionSection"; section: SessionSection };

export const INITIAL_DESKTOP_NAVIGATION: DesktopNavigation = {
  view: "dashboard",
  sessionId: null,
  sessionSection: "overview",
};

export function reduceDesktopNavigation(
  state: DesktopNavigation,
  event: NavigationEvent,
): DesktopNavigation {
  switch (event.type) {
    case "open":
      return { view: event.view, sessionId: null, sessionSection: "overview" };
    case "openSession":
      return { view: "session", sessionId: event.sessionId, sessionSection: event.section ?? "overview" };
    case "startImport":
      return { view: "importProgress", sessionId: null, sessionSection: "overview" };
    case "importCompleted":
      return { view: "session", sessionId: event.sessionId, sessionSection: "overview" };
    case "importFailed":
      return { view: "import", sessionId: null, sessionSection: "overview" };
    case "startDelivery":
      return { view: "session", sessionId: event.sessionId, sessionSection: "generate" };
    case "deliveryCompleted":
      return { view: "session", sessionId: event.sessionId, sessionSection: "generate" };
    case "showSessionSection":
      return state.view === "session" && state.sessionId
        ? { ...state, sessionSection: event.section }
        : state;
  }
}

export function isTaskInProgress(view: DesktopView): boolean {
  return view === "importProgress";
}
