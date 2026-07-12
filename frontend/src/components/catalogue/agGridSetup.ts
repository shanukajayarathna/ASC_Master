import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { AllEnterpriseModule, LicenseManager } from "ag-grid-enterprise";

ModuleRegistry.registerModules([AllCommunityModule, AllEnterpriseModule]);

// No AG Grid Enterprise license key is configured — get one from
// https://www.ag-grid.com/license-pricing/ and set NEXT_PUBLIC_AG_GRID_LICENSE_KEY
// in .env.local. Without it, Enterprise features work in dev but the grid
// shows a watermark and a console warning.
const licenseKey = process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY;
if (licenseKey) {
  LicenseManager.setLicenseKey(licenseKey);
}
