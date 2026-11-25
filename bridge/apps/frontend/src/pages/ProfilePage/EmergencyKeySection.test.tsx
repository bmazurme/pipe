import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@gravity-ui/uikit";

import { EmergencyKeySection } from "./EmergencyKeySection";
import { store } from "../../store";
import { authApi } from "../../store/api";

const NONE = { exists: false, prefix: null, createdAt: null, lastUsedAt: null };
const EXISTS = {
  exists: true,
  prefix: "bre_AAAAAAAA",
  createdAt: "2026-10-13T12:00:00Z",
  lastUsedAt: null,
};
const TOKEN = "bre_THE-PLAINTEXT-SHOWN-ONCE-0123456789abcdef";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderSection() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter>
          <EmergencyKeySection />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );
}

let status: unknown;
let requests: string[];

beforeEach(() => {
  status = NONE;
  requests = [];
  store.dispatch(authApi.util.resetApiState());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      const { pathname } = new URL(request.url);
      requests.push(`${request.method} ${pathname}`);

      if (pathname.endsWith("/auth/emergency-key")) {
        if (request.method === "POST") {
          status = EXISTS;
          return jsonResponse(
            { prefix: "bre_AAAAAAAA", token: TOKEN, createdAt: "2026-10-13T12:00:00Z" },
            201,
          );
        }
        if (request.method === "DELETE") {
          status = NONE;
          return new Response(null, { status: 204 });
        }
        return jsonResponse(status);
      }

      return jsonResponse({}, 404);
    }),
  );
});

describe("EmergencyKeySection", () => {
  it("says there is no key yet and offers to create one", async () => {
    renderSection();

    expect(await screen.findByText("Ключа ещё нет.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Создать" })).toBeTruthy();
  });

  it("creates a key and shows the plaintext once, in a dialog", async () => {
    renderSection();

    await screen.findByText("Ключа ещё нет."); // the button is disabled until the status has loaded
    await userEvent.click(screen.getByRole("button", { name: "Создать" }));

    expect(await screen.findByText(TOKEN)).toBeTruthy();
    expect(requests).toContain("POST /api/v1/auth/emergency-key");

    await userEvent.click(screen.getByRole("button", { name: "Готово" }));
    await waitFor(() => expect(screen.queryByText(TOKEN)).toBeNull());
    // after closing, only the prefix remains — the plaintext is gone from the page
    expect(await screen.findByText(/bre_AAAAAAAA…/)).toBeTruthy();
    expect(screen.getByText("ещё не использован")).toBeTruthy();
  });

  it("asks before replacing an existing key (the old one stops working at once)", async () => {
    status = EXISTS;
    renderSection();

    await screen.findByText(/bre_AAAAAAAA…/);
    await userEvent.click(screen.getByRole("button", { name: "Заменить" }));

    expect(await screen.findByText("Заменить аварийный ключ?")).toBeTruthy();
    expect(requests).not.toContain("POST /api/v1/auth/emergency-key");

    await userEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(requests).not.toContain("POST /api/v1/auth/emergency-key");
  });

  it("revokes the key", async () => {
    status = EXISTS;
    renderSection();

    await userEvent.click(await screen.findByRole("button", { name: "Отозвать" }));

    await waitFor(() => expect(requests).toContain("DELETE /api/v1/auth/emergency-key"));
    expect(await screen.findByText("Ключа ещё нет.")).toBeTruthy();
  });
});
