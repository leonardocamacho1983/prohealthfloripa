import { SignIn } from "@clerk/nextjs";

import styles from "../../handoff/handoff.module.css";

export default function SignInPage() {
  return (
    <main className={styles.loginShell}>
      <SignIn
        appearance={{ variables: { colorPrimary: "#14784b" } }}
        fallbackRedirectUrl="/handoff"
        path="/sign-in"
        routing="path"
        withSignUp={false}
      />
    </main>
  );
}
