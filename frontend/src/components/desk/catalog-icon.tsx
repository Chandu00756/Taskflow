import * as React from 'react';
import { AppWindow, Download, HardDrive, KeyRound, Laptop, Mail, Monitor, Package, Phone, Printer, ShieldCheck, Smartphone, Wifi } from 'lucide-react';

const ICONS: Record<string, React.ElementType> = {
  laptop: Laptop, monitor: Monitor, 'app-window': AppWindow, 'key-round': KeyRound, download: Download, 'shield-check': ShieldCheck,
  mail: Mail, package: Package, phone: Phone, printer: Printer, smartphone: Smartphone, wifi: Wifi, 'hard-drive': HardDrive,
};

export const CATALOG_ICON_NAMES = Object.keys(ICONS);

export function CatalogIcon({ name, className }: { name?: string; className?: string }) {
  const Icon = (name && ICONS[name]) || Package;
  return <Icon className={className} />;
}
