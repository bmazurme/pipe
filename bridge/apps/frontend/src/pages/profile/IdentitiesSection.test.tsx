import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@gravity-ui/uikit";

import { IdentitiesSection } from "./IdentitiesSection";
import { store } from "../../store";
import { authApi, sessionsApi } from "../../store/api";

const YANDEX = {
  provider: "yandex",
  email: "me@ya.ru",
  enabled: true,
  lastUsedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
};
const GITHUB = { ...YANDEX, provider: "github", email: "me@gh.com" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderSection(path = "/profile?tab=access") {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <MemoryRouter initialEntries={[path]}>
          <IdentitiesSection />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );
}

let identities: unknown[];
let requests: string[];

beforeEach(() => {
  identities = [YANDEX];
  requests = [];
  store.dispatch(sessionsApi.util.resetApiState());
  store.dispatch(authApi.util.resetApiState());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      const { pathname } = new URL(request.url);
      requests.push(`${request.method} ${pathname}`);

      if (pathname.endsWith("/oauth/providers")) {
        return jsonResponse({ providers: ["yandex", "github"] });
      }
      if (pathname.endsWith("/auth/identities")) {
        return jsonResponse(identities);
      }
      if (pathname.endsWith("/auth/identities/github/disable")) {
        identities = [YANDEX, { ...GITHUB, enabled: false }];
        return new Response(null, { status: 204 });
      }

      return jsonResponse({}, 404);
    }),
  );
});

describe("IdentitiesSection", () => {
  it("lists the connected method and offers to connect the other configured one", async () => {
    renderSection();

    expect(await screen.findByText("Яндекс ID")).toBeTruthy();
    expect(screen.getByText(/me@ya\.ru/)).toBeTruthy();
    expect(
      await screen.findByRole("button", { name: /Подключить GitHub/ }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Подключить Яндекс/ }),
    ).toBeNull();
  });

  it("does not let the only enabled method be switched off or unlinked", async () => {
    renderSection();

    await screen.findByText("Яндекс ID");

    expect(screen.getByLabelText("Отвязать Яндекс ID")).toBeDisabled();
    expect(
      screen.getByRole("switch", { name: "Вход через Яндекс ID" }),
    ).toBeDisabled();
  });

  it("disables one of two enabled methods", async () => {
    identities = [YANDEX, GITHUB];
    renderSection();

    await screen.findByText("GitHub");
    await userEvent.click(
      screen.getByRole("switch", { name: "Вход через GitHub" }),
    );

    await waitFor(() =>
      expect(requests).toContain("POST /api/v1/auth/identities/github/disable"),
    );
  });

  it("shows the outcome the provider redirect brought back", async () => {
    renderSection(
      "/profile?tab=access&linkError=%D0%B7%D0%B0%D0%BD%D1%8F%D1%82",
    );

    expect(await screen.findByText("занят")).toBeTruthy();
  });
});
