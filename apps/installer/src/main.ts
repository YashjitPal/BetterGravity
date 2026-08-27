import "./styles/global.css";
import { createPatcherGateway } from "./services/patcher-gateway";
import { InstallerController } from "./ui/installer-controller";

void new InstallerController(createPatcherGateway()).start();
