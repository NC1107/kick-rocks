import { MIN_PASSWORD_LENGTH, Password } from "@kickrocks/shared";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiRequestError, errorMessage, useSetup } from "../../api/index.js";
import { Button, Callout, Card, Field, Input } from "../../components/ui/index.js";
import { usePageTitle } from "../../lib/use-page-title.js";
import { PasswordInput } from "../login/password-input.js";

export function Component() {
  usePageTitle("Set a password");
  const setup = useSetup();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<{ password?: string; confirm?: string }>({});

  useEffect(() => input.current?.focus(), []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const checked = Password.safeParse(password);
    if (!checked.success) {
      setProblem({ password: `Use at least ${MIN_PASSWORD_LENGTH} characters.` });
      return;
    }
    if (password !== confirm) {
      setProblem({ confirm: "The two passwords do not match." });
      return;
    }
    setProblem({});
    setup.mutate({ body: { password } });
  };

  const failure = setup.error;
  const fieldIssue = failure instanceof ApiRequestError ? failure.fieldErrors.password : undefined;

  return (
    <Card className="mx-auto w-full max-w-[22.5rem] rounded-lg">
      <h1 className="text-heading font-semibold text-ink">Set a password</h1>
      <p className="mt-0.5 mb-4 text-meta text-ink-3">This password signs you in.</p>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
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
        <Field
          label="Password"
          help={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          error={problem.password ?? fieldIssue}
        >
          <PasswordInput
            ref={input}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Field label="Confirm password" error={problem.confirm}>
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </Field>
        <Callout intent="info" title="Back up the data volume">
          Your data is encrypted with a key that is stored next to the database, not with this
          password. Under Docker both live in the kickrocks-data volume, so back up that volume as a
          whole, key included. Without the key the data cannot be opened. The section "Backups and
          restore" in docs/self-hosting.md has the commands.
        </Callout>
        {failure && !fieldIssue ? <Callout intent="danger">{errorMessage(failure)}</Callout> : null}
        <Button type="submit" variant="primary" loading={setup.isPending} className="w-full">
          Set password
        </Button>
      </form>
    </Card>
  );
}
