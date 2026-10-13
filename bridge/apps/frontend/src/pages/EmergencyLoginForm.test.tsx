import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { ThemeProvider } from "@gravity-ui/uikit";

import { EmergencyLoginForm } from "./EmergencyLoginForm";
import { store } from "../store";
import { authApi } from "../store/api";

let calls: { url: string; body: unknown }[];
let status: number;

beforeEach(() => {
  calls = [];
  status = 200;
  store.dispatch(authApi.util.resetApiState());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      const { pathname } = new URL(request.url);
      const body = request.method === "POST" ? await request.json() : undefined;
      calls.push({ url: `${request.method} ${pathname}`, body });

      return new Response(JSON.stringify({ isAuthenticated: status === 200 }), {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

function renderForm() {
  return render(
    <Provider store={store}>
      <ThemeProvider theme="light">
        <EmergencyLoginForm />
      </ThemeProvider>
    </Provider>,
  );
}

describe("EmergencyLoginForm", () => {
  it("is collapsed until asked for, so it never competes with the normal sign-in buttons", () => {
    renderForm();

    expect(screen.getByRole("button", { name: "Аварийный вход по ключу" })).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Аварийный ключ/)).toBeNull();
  });

  it("sends the key, trimmed, to the emergency-login endpoint", async () => {
    renderForm();

    await userEvent.click(screen.getByRole("button", { name: "Аварийный вход по ключу" }));
    await userEvent.type(screen.getByPlaceholderText(/Аварийный ключ/), "  bre_the-key  ");
    await userEvent.click(screen.getByRole("button", { name: "Войти по ключу" }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        url: "POST /api/v1/auth/emergency-login",
        body: { key: "bre_the-key" },
      }),
    );
  });

  it("does not submit an empty key", async () => {
    renderForm();

    await userEvent.click(screen.getByRole("button", { name: "Аварийный вход по ключу" }));

    expect(screen.getByRole("button", { name: "Войти по ключу" })).toBeDisabled();
  });

  it("says plainly that the key is wrong", async () => {
    status = 401;
    renderForm();

    await userEvent.click(screen.getByRole("button", { name: "Аварийный вход по ключу" }));
    await userEvent.type(screen.getByPlaceholderText(/Аварийный ключ/), "bre_wrong");
    await userEvent.click(screen.getByRole("button", { name: "Войти по ключу" }));

    expect(await screen.findByText("Неверный или отозванный ключ")).toBeTruthy();
  });

  it("tells a throttled caller to wait", async () => {
    status = 429;
    renderForm();

    await userEvent.click(screen.getByRole("button", { name: "Аварийный вход по ключу" }));
    await userEvent.type(screen.getByPlaceholderText(/Аварийный ключ/), "bre_x");
    await userEvent.click(screen.getByRole("button", { name: "Войти по ключу" }));

    expect(await screen.findByText(/Слишком много попыток/)).toBeTruthy();
  });
});
