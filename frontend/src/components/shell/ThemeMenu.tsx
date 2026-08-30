"use client";

import { useThemeMode } from "@/context/ThemeModeContext";
import CheckIcon from "@mui/icons-material/Check";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import SettingsBrightnessOutlinedIcon from "@mui/icons-material/SettingsBrightnessOutlined";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import { useState, type MouseEvent } from "react";

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: LightModeOutlinedIcon },
  { value: "dark", label: "Dark", icon: DarkModeOutlinedIcon },
  { value: "system", label: "System", icon: SettingsBrightnessOutlinedIcon },
] as const;

/**
 * Light/Dark/System toggle — a single shared control (the authenticated Topbar, the public
 * landing nav, and the login/request-access shell all render this exact component) so the
 * theme switcher looks and behaves identically whether or not the visitor is signed in.
 */
export default function ThemeMenu() {
  const { mode, preference, setPreference } = useThemeMode();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const CurrentIcon = mode === "dark" ? DarkModeOutlinedIcon : LightModeOutlinedIcon;

  return (
    <>
      <Tooltip title="Theme">
        <IconButton onClick={(e: MouseEvent<HTMLElement>) => setAnchor(e.currentTarget)} size="small" aria-label="Change theme">
          <CurrentIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
        {THEME_OPTIONS.map((opt) => (
          <MenuItem
            key={opt.value}
            selected={preference === opt.value}
            onClick={() => {
              setPreference(opt.value);
              setAnchor(null);
            }}
          >
            <ListItemIcon>
              <opt.icon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{opt.label}</ListItemText>
            {preference === opt.value && <CheckIcon fontSize="small" sx={{ color: "var(--liquor)", ml: 1 }} />}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
