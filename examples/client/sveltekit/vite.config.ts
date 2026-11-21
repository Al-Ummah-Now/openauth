import adapter from "@sveltejs/adapter-auto"
import { sveltekit } from "@sveltejs/kit/vite"
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [
    sveltekit({
      // SvelteKit 3 takes its configuration here instead of svelte.config.js.
      // adapter-auto only supports some environments, see
      // https://svelte.dev/docs/kit/adapter-auto for a list.
      adapter: adapter(),
      preprocess: vitePreprocess(),
    }),
  ],
})
