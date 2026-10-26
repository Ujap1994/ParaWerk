/** The camera controller of the 3D view (src/renderer/src/viewport/camera-controller.ts). */
import { Sphere, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CameraController } from '../../src/renderer/src/viewport/camera-controller.ts';
import { VIEW_DIRECTIONS, viewQuaternion } from '../../src/renderer/src/viewport/views.ts';

describe('camera controller', () => {
  it('fits the view in the direction it is turning to, not where the turn is now', () => {
    const controller = new CameraController();
    const top = viewQuaternion(VIEW_DIRECTIONS.top);
    const bounds = new Sphere(new Vector3(), 50);
    // Turning to the top view (as when a sketch on the top plane is opened) ...
    controller.animateTo(controller.fitState(bounds, 1.5, top), 320);
    expect(controller.animating).toBe(true);
    // ... a body arrives and the view is fitted to it: still towards the top view.
    const fitted = controller.fitState(new Sphere(new Vector3(10, 0, 0), 80), 1.5);
    expect(fitted.quaternion.angleTo(top)).toBeCloseTo(0, 9);
    expect(fitted.target.x).toBe(10);
  });

  it('fits a still view in the direction it looks in', () => {
    const controller = new CameraController();
    const fitted = controller.fitState(new Sphere(new Vector3(), 10), 1);
    expect(fitted.quaternion.angleTo(controller.state.quaternion)).toBeCloseTo(0, 9);
  });
});
