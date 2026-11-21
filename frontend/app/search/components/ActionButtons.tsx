import React from 'react';
import Link from 'next/link';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import TableViewOutlinedIcon from '@mui/icons-material/TableViewOutlined';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import HistoryIcon from '@mui/icons-material/History';
import MonitorHeartOutlinedIcon from '@mui/icons-material/MonitorHeartOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import type { ActionButton } from '../types';
import { resolveActionHref } from '../utils/actionLinks';

interface ActionButtonsProps {
  actions?: ActionButton[];
}

const ICON_MAP: Record<ActionButton['type'], React.ReactNode> = {
  spl_view: <DescriptionOutlinedIcon sx={{ fontSize: 16 }} />,
  labelcomp: <CompareArrowsIcon sx={{ fontSize: 16 }} />,
  labelquery: <TableViewOutlinedIcon sx={{ fontSize: 16 }} />,
  drugtox: <ScienceOutlinedIcon sx={{ fontSize: 16 }} />,
  label_history: <HistoryIcon sx={{ fontSize: 16 }} />,
  faers: <MonitorHeartOutlinedIcon sx={{ fontSize: 16 }} />,
};

export const ActionButtons: React.FC<ActionButtonsProps> = ({ actions }) => {
  if (!actions || actions.length === 0) return null;

  return (
    <div className="lc-actions-bar" role="group" aria-label="Recommended actions">
      {actions.map((action, idx) => {
        const href = resolveActionHref(action);
        return (
          <Link
            key={`${action.type}-${idx}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={`lc-action-btn lc-action-btn--${action.type}`}
          >
            <span className="lc-action-icon">{ICON_MAP[action.type]}</span>
            <span className="lc-action-label">{action.label}</span>
            <OpenInNewIcon sx={{ fontSize: 13, opacity: 0.65 }} />
          </Link>
        );
      })}
    </div>
  );
};
