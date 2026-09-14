// Marker slice: the named points on the timeline and the jumps between them.
// The two `goTo*Marker` actions read `currentTime` off the `set` updater's
// state — it belongs to the playback slice, and no import is needed for that.

import { v4 as uuidv4 } from 'uuid';
import type { StateCreator } from 'zustand';
import type { EditorState } from './types';

export type MarkerSlice = Pick<EditorState, 'markers' | 'addMarker' | 'removeMarker' | 'updateMarker' | 'clearMarkers' | 'goToNextMarker' | 'goToPreviousMarker'>;

export const createMarkerSlice: StateCreator<EditorState, [], [], MarkerSlice> = (set) => ({
  markers: [],

  // Marker actions
  addMarker: (time: number, label?: string, color?: string) => {
    const marker = {
      id: uuidv4(),
      time,
      label: label || '',
      color: color || '#ffcc00',
    };
    set((state) => ({
      markers: [...state.markers, marker].sort((a, b) => a.time - b.time),
    }));
    return marker;
  },

  removeMarker: (markerId: string) => set((state) => ({
    markers: state.markers.filter((m) => m.id !== markerId),
  })),

  updateMarker: (markerId: string, updates: Partial<{ time: number; label: string; color: string }>) => set((state) => ({
    markers: state.markers
      .map((m) => (m.id === markerId ? { ...m, ...updates } : m))
      .sort((a, b) => a.time - b.time),
  })),

  clearMarkers: () => set({ markers: [] }),

  goToNextMarker: () => set((state) => {
    const nextMarker = state.markers.find((m) => m.time > state.currentTime);
    if (nextMarker) {
      return { currentTime: nextMarker.time };
    }
    return {};
  }),

  goToPreviousMarker: () => set((state) => {
    const previousMarkers = state.markers.filter((m) => m.time < state.currentTime);
    if (previousMarkers.length > 0) {
      const prevMarker = previousMarkers[previousMarkers.length - 1];
      return { currentTime: prevMarker.time };
    }
    return {};
  }),
});
