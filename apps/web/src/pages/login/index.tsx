import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiRequestError, errorMessage, useLogin } from "../../api/index.js";
import { Button, Callout, Card, Field } from "../../components/ui/index.js";
import { usePageTitle } from "../../lib/use-page-title.js";
import { PasswordInput } from "./password-input.js";

export function Component() {
  usePageTitle("Sign in");
  const login = useLogin();
  const [password, setPassword] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password) login.mutate({ body: { password } });
  };

  const failure = login.error;
  const wrongPassword = failure instanceof ApiRequestError && failure.status === 401;

  return (
    <Card className="mx-auto w-full max-w-[22.5rem] rounded-lg">
      <h1 className="text-heading font-semibold text-ink">Sign in</h1>
      <p className="mt-0.5 mb-4 text-meta text-ink-3">Enter the password for this instance.</p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {/* Gives password managers an account name to save the password under. */}
        <input
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          autoComplete="username"
          name="username"
          defaultValue="kickrocks"
          readOnly
        />
        <Field label="Password" error={wrongPassword ? failure.message : undefined}>
          <PasswordInput
            ref={input}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        {failure && !wrongPassword ? (
          <Callout intent="danger">{errorMessage(failure)}</Callout>
        ) : null}
        <Button type="submit" variant="primary" loading={login.isPending} className="w-full">
          Sign in
        </Button>
      </form>
    </Card>
  );
}
