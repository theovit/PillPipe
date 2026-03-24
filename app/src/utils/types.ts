export interface Supplement {
  id: string;
  name: string;
  brand: string | null;
  pills_per_bottle: number;
  price: number;
  type: 'maintenance' | 'protocol';
  current_inventory: number;
  unit: 'capsules' | 'tablets' | 'ml' | 'drops';
  drops_per_ml: number;
  reorder_threshold: number | null;
  reorder_threshold_mode: string;
  created_at: string;
}

export interface Session {
  id: string;
  start_date: string;
  target_date: string;
  notes: string | null;
  created_at: string;
}

export interface Regimen {
  id: string;
  session_id: string;
  supplement_id: string;
  notes: string | null;
  reminder_time: string | null;
  created_at: string;
  // joined fields
  supplement_name?: string;
  brand?: string | null;
  pills_per_bottle?: number;
  price?: number;
  unit?: string;
  drops_per_ml?: number;
  current_inventory?: number;
}

export interface Phase {
  id: string;
  regimen_id: string;
  dosage: number;          // legacy — retained for DB compatibility, not used in UI
  dose_morning: number;
  dose_lunch: number;
  dose_dinner: number;
  dose_custom: number;
  custom_time: string | null;  // "HH:MM", only populated when dose_custom > 0
  duration_days: number;
  days_of_week: string | null;
  indefinite: number;
  sequence_order: number;
  created_at: string;
}

export interface DoseLog {
  id: string;
  regimen_id: string;
  log_date: string;
  status: 'taken' | 'skipped';
  created_at: string;
}

export interface RegNotif {
  id: string;
  regimen_id: string;
  type: 'morning' | 'lunch' | 'dinner' | 'custom';
  custom_time: string | null;
}
