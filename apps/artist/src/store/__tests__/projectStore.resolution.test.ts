import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../projectStore';
import { RESOLUTION_PRESETS } from '../types';

describe('Project Resolution', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useEditorStore.getState().resetProject();
    useEditorStore.getState().clearHistory();
  });

  describe('default resolution', () => {
    it('should have 720p (1280x720) as default resolution', () => {
      const { project } = useEditorStore.getState();
      expect(project.resolution).toEqual({ width: 1280, height: 720 });
    });

    it('should match the 720p preset', () => {
      const { project } = useEditorStore.getState();
      expect(project.resolution).toEqual(RESOLUTION_PRESETS['720p']);
    });
  });

  describe('RESOLUTION_PRESETS', () => {
    it('should have 720p preset', () => {
      expect(RESOLUTION_PRESETS['720p']).toEqual({ width: 1280, height: 720 });
    });

    it('should have 1080p preset', () => {
      expect(RESOLUTION_PRESETS['1080p']).toEqual({ width: 1920, height: 1080 });
    });

    it('should have 1440p preset', () => {
      expect(RESOLUTION_PRESETS['1440p']).toEqual({ width: 2560, height: 1440 });
    });

    it('should have 4K preset', () => {
      expect(RESOLUTION_PRESETS['4K']).toEqual({ width: 3840, height: 2160 });
    });
  });

  describe('setProjectResolution', () => {
    it('should update the project resolution', () => {
      const store = useEditorStore.getState();
      store.setProjectResolution(1920, 1080);

      const { project } = useEditorStore.getState();
      expect(project.resolution).toEqual({ width: 1920, height: 1080 });
    });

    it('should update modified timestamp', () => {
      const { project: before } = useEditorStore.getState();
      const modifiedBefore = before.modified;

      // Small delay to ensure timestamp differs
      useEditorStore.getState().setProjectResolution(1920, 1080);

      const { project: after } = useEditorStore.getState();
      expect(after.modified).toBeGreaterThanOrEqual(modifiedBefore);
    });

    it('should support custom resolutions', () => {
      useEditorStore.getState().setProjectResolution(800, 600);

      const { project } = useEditorStore.getState();
      expect(project.resolution).toEqual({ width: 800, height: 600 });
    });
  });

  describe('undo/redo', () => {
    it('should undo resolution change', () => {
      const { project: original } = useEditorStore.getState();
      const originalResolution = { ...original.resolution };

      useEditorStore.getState().setProjectResolution(1920, 1080);
      expect(useEditorStore.getState().project.resolution).toEqual({ width: 1920, height: 1080 });

      useEditorStore.getState().undo();
      expect(useEditorStore.getState().project.resolution).toEqual(originalResolution);
    });

    it('should redo resolution change', () => {
      useEditorStore.getState().setProjectResolution(1920, 1080);
      useEditorStore.getState().undo();

      expect(useEditorStore.getState().project.resolution).toEqual({ width: 1280, height: 720 });

      useEditorStore.getState().redo();
      expect(useEditorStore.getState().project.resolution).toEqual({ width: 1920, height: 1080 });
    });

    it('should support multiple undo steps', () => {
      useEditorStore.getState().setProjectResolution(1920, 1080);
      useEditorStore.getState().setProjectResolution(3840, 2160);

      expect(useEditorStore.getState().project.resolution).toEqual({ width: 3840, height: 2160 });

      useEditorStore.getState().undo();
      expect(useEditorStore.getState().project.resolution).toEqual({ width: 1920, height: 1080 });

      useEditorStore.getState().undo();
      expect(useEditorStore.getState().project.resolution).toEqual({ width: 1280, height: 720 });
    });
  });

  describe('session state preservation', () => {
    it('should preserve resolution when setting other project properties via setProject', () => {
      useEditorStore.getState().setProjectResolution(1920, 1080);

      const currentProject = useEditorStore.getState().project;
      useEditorStore.getState().setProject({
        ...currentProject,
        name: 'New Name',
      });

      expect(useEditorStore.getState().project.resolution).toEqual({ width: 1920, height: 1080 });
      expect(useEditorStore.getState().project.name).toBe('New Name');
    });

    it('should preserve resolution across resetProject', () => {
      // resetProject creates a new project, which should have the default resolution
      useEditorStore.getState().setProjectResolution(1920, 1080);
      useEditorStore.getState().resetProject();

      // After reset, resolution should be back to default
      expect(useEditorStore.getState().project.resolution).toEqual({ width: 1280, height: 720 });
    });
  });
});
