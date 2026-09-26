import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SignInPage } from "../../../pages/sign-in-page/component/SignInPage.js";
import { SignUpPage } from "../../../pages/sign-up-page/component/SignUpPage.js";
import { renderWithAuth } from "../../../test/render-with-auth.js";
import { AuthLayout } from "./AuthLayout.js";

describe("auth pages and layout", () => {
  it("renders AuthLayout title and footer", async () => {
    await renderWithAuth(
      <AuthLayout title="Welcome" footer={<p>Footer note</p>}>
        <p>Body</p>
      </AuthLayout>,
    );
    expect(screen.getByText("Welcome")).toBeTruthy();
    expect(screen.getByText("Body")).toBeTruthy();
    expect(screen.getByText("Footer note")).toBeTruthy();
  });

  it("renders SignInPage copy and form", async () => {
    await renderWithAuth(<SignInPage />);
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByText(/Need an account/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Forgot password?" })).toBeTruthy();
  });

  it("renders SignUpPage copy and form", async () => {
    await renderWithAuth(<SignUpPage />);
    expect(screen.getByRole("heading", { name: "Create account" })).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByText("Already have an account?")).toBeTruthy();
  });
});
