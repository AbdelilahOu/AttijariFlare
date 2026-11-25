import { Title } from "@solidjs/meta";
import { QueryClientProvider } from "@tanstack/solid-query";
import { Loading } from "solid-js";

import Loader from "~/components/loader";
import Shell from "~/components/shell";
import { Router } from "~/router";
import { createQueryClient } from "~/utils/orpc";

import "./styles.css";

export default function App() {
  const queryClient = createQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        {(props) => (
          <>
            <Title>AttijariFlare</Title>
            <Shell>
              <Loading fallback={<Loader />}>{props.children}</Loading>
            </Shell>
          </>
        )}
      </Router>
    </QueryClientProvider>
  );
}
