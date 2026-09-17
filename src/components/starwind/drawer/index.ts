import Drawer from "./Drawer.astro";
import DrawerClose from "./DrawerClose.astro";
import DrawerContent from "./DrawerContent.astro";
import DrawerTitle from "./DrawerTitle.astro";

const DrawerNamespace = {
  Root: Drawer,
  Content: DrawerContent,
  Title: DrawerTitle,
  Close: DrawerClose,
};

export { Drawer, DrawerClose, DrawerContent, DrawerTitle };

export default DrawerNamespace;
