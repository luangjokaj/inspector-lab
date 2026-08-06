import "styled-components";
import type { Theme } from "cherry-styled-components";

declare module "styled-components" {
  export interface DefaultTheme extends Theme {}
}
