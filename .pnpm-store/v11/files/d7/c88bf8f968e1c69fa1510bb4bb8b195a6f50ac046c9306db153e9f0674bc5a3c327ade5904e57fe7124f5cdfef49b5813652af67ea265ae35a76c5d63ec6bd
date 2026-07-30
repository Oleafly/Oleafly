# Spline Runtime

**runtime** allows you to run Spline scenes in javascript.

## Install

```bash
npm install @splinetool/runtime
```

## Usage

To use runtime, first you have to go to the Spline editor, click on the **Export** button, select "**Code**" and then "**Vanilla JS**".

You can copy the URL there and pass it to the `.load()` function:

```js
import { Application } from '@splinetool/runtime';

// make sure you have a canvas in the body
const canvas = document.getElementById('canvas3d');

// start the application and load the scene
const spline = new Application(canvas);
spline.load('https://prod.spline.design/6Wq1Q7YGyM-iab9i/scene.splinecode');
```

You should be able to see the scene you exported in your canvas.

**NOTE**: If you are experiencing CORS issues, you can download the .splinecode file and self-host it; this will fix any CORS issue. To download, go to Spline's code export panel and click on the download icon visible in the prod.spline textarea.

> :warning: Only **.splinecode** files should be loaded through this API. `.spline` files are meant to be used in the editor.

### Read and modify Spline objects

You can query any Spline object via `findObjectByName` or `findObjectById`.

_(You can get the ID of the object in the `Develop` pane of the right sidebar)._

```js
import { Application } from '@splinetool/runtime';

const canvas = document.getElementById('canvas3d');
const spline = new Application(canvas);
spline
	.load('https://prod.spline.design/6Wq1Q7YGyM-iab9i/scene.splinecode')
	.then(() => {
		const obj = spline.findObjectByName('Cube');
		// or
		// const obj = spline.findObjectById('7AF5EBC0-09BB-4720-B045-F478F8053AA4');

		console.log(obj); // Spline Object => { name: 'Cube', id: '7AF5EBC0-09BB-4720-B045-F478F8053AA4', position: {}, ... }

		// move the object in 3D space
		obj.position.x += 10;
	});
```

### Listen to events

You can listen to any Spline Event you set in the Events panel of the editor by attaching a listener to the Spline instance.

```js
import { Application } from '@splinetool/runtime';

const canvas = document.getElementById('canvas3d');
const spline = new Application(canvas);
spline
	.load('https://prod.spline.design/6Wq1Q7YGyM-iab9i/scene.splinecode')
	.then(() => {
		spline.addEventListener('mouseDown', (e) => {
			if (e.target.name === 'Cube') {
				console.log('I have been clicked!');
			}
		});
	});
```

You can find a list of all of the Spline Event listeners in the [API](#api) section.

### Trigger Spline events from outside

You can trigger any animation Event you set in the Events panel in the Spline Editor.

You can use the `emitEvent` function, passing the [event type](#spline-events) and the name or ID of your object.

_(You can get the ID of the object in the `Develop` pane of the right sidebar)._

```js
import { Application } from '@splinetool/runtime';

const canvas = document.getElementById('canvas3d');
const spline = new Application(canvas);
spline
	.load('https://prod.spline.design/6Wq1Q7YGyM-iab9i/scene.splinecode')
	.then(() => {
		spline.emitEvent('mouseHover', 'Cube');
	});
```

Or you can query the spline object first, and then trigger the event:

```js
import { Application } from '@splinetool/runtime';

const canvas = document.getElementById('canvas3d');
const spline = new Application(canvas);
spline
	.load('https://prod.spline.design/6Wq1Q7YGyM-iab9i/scene.splinecode')
	.then(() => {
		const obj = spline.findObjectByName('Cube');
		objectToAnimate.emitEvent('mouseHover');
	});
```

You can find a list of all of the Spline Events you can pass to the `emitEvent` function in the [Spline Events](#spline-events) section.

### Preloading your scene

You might want to start the loading of `.splinecode` file before your code is loaded. It's possible using a [HTML preload Link tag](https://developer.mozilla.org/en-US/docs/Web/HTML/Link_types/preload). Doing so will only save a little time by ensuring the spline file loading starts before your scripts are done loading. Since internally the `.splinecode` file will be loaded through a `fetch` call, you can do it like this :

```HTML
<html>
<head>
	<!--
		add a preload link tag
		with the scene your want to preload
		at the end of your <head>
		It needs to use the fetch preload type
	-->
	<link rel="preload" href="https://prod.spline.design/6Wq1Q7YGyM-iab9i/scene.splinecode" as="fetch"
</head>
```

```js
/*
	When loading the Application, use the third
	param of the load function to make sure the browser
	will use the preloaded file and not make another request
*/
spline.load(
	'https://prod.spline.design/6Wq1Q7YGyM-iab9i/scene.splinecode',
	undefined,
	{
		credentials: 'include',
		mode: 'no-cors',
	}
);
```

### Updating scene variables

If you setup variables in your Spline scene from the editor, you can change them from code either while loading the scene, of after it's loaded.
Note that if in Spline editor you have multiple variables with the same name, only the first one will be updated, so make sure to give unique names to the variables you want to update.
Also note that the values you pass to your variables will be casted into their original type (number, boolean or string).

```js
const spline = new Application(canvas);

// Create an object describing the variables you want to update during load
const myVariables = { myName: 'John', mySize: 350 };

// And pass them as second parameter for the load function
spline.load('.../scene.splinecode', myVariables);

// Later you can update your variables again
spline.setVariables({ myName: 'Paul', mySize: 100 });

// Or change only one variable
spline.setVariable('myName', 'Ringo');
```

### Procedural Transitions

If you don't want to define your transition as actions in Spline Editor, it's possible to write and control them from this API. Note that you still need to set the object states from Spline editor, this API will only enable transitioning from one state to another, essentially exposing Spline's Transition action.

```js
import { Easing } from '@splinetool/runtime'

// ...

const sphere = spline.findObjectByName('Sphere')!;

// Simplest way to transition sphere from current state to State.
// The "to" param is the only mandatory parameter.
sphere.transition({ to: 'State' });

// Same transition with all params set with their default values
sphere.transition({
  from: undefined, // State name to start from, undefined will start from current state
  to: 'State', // State name to go to, null will go to base state
  duration: 1000, // in ms
  delay: 0, // in ms
  easing: Easing.LINEAR,
  autoplay: true
});

// Force transition from Base State
sphere.transition({ from: null, to: 'State' })

// Chaining two transitions, the second one will be playing after first one is over
sphere.transition({ to: 'State' }).transition({ to: 'State 2' });

// Save transition object for later use
const transition = sphere.transition({ to: 'State', autoPlay: false }).transition({ to: 'State 2' });
transition.play()
transition.pause()
transition.reset()
transition.seek(1000)
```

### Swapping Geometries

It's possible to replace a geometry using the `app.swapGeometry(objectName, 'path/to/new.splinegeometry)` function. You first need to generate a `.splinegeometry` file from the editor by right clicking on a mesh object and selecting `Export Geometry`. This is useful if you have optional geometries / objects in your scene that you don't want to load at first. This will help make initial `.spline` file smaller and faster to load. First parameter can either object name or object UUID. Second parameter can either be the url to a `.splinegeometry` file or a Uint8Array wrapping the content of a `.splinegeometry` file.

```js
app.load('scene.spline').then(() => {
	catButton.addEventListener('click', async () => {
		// By default second parameter is an url to a .splinegeometry file
		await app.swapGeometry('Animal', 'url/to/cat.splinegeometry');
	});

	dogButton.addEventListener('click', async () => {
		// It's also possible to load the .splinegeometry file yourself if you want to manage some kind of cache or reuse one geometry for multiple objects / file
		const res = await fetch('url/to/dog.splinegeometry');
		const buffer = await res.arrayBuffer();
		const dogGeometry = new Uint8Array(buffer);
		await app.swapGeometry('Animal', dogGeometry);
	});
});
```

### Reading or changing material and material layers properties

```js
app.load('scene.spline').then(() => {
	const obj = spline.findObjectByName('Cube');
	const material = obj.material;

	// material have a global alpha value (from 0 to 1)
	material.alpha = 0.25;

	// and the list of the layers you defined in Spline
	const layers = material.layers;

	// You can differentiate layer by type
	const fresnelLayer = layers.find((l) => l.type === 'fresnel');

	if (fresnelLayer) {
		// And change properties for this layer directly
		fresnelLayer.factor = 0.5;
	}
});
```

### Updating textures

```js
app.load('scene.spline').then(async () => {
	const obj = spline.findObjectByName('Cube');
	const textureLayer = obj.material.layers.find((l) => l.type === 'texture');
	if (textureLayer) {
		// By targetting a material layer that has a texture it's possible to change this texture's image
		await textureLayer.updateTexture('/path-to-new-texture.png');
	}
});
```

## API

### Spline Application Methods

You can call all these different methods on the Spline `Application` instance.

| Name                  | Type                                                                 | Description                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `addEventListener`    | `(eventName: SplineEventName, cb: (e: SplineEvent) => void) => void` | Add an event listener for Spline events.                                                                                                           |
| `removeEventListener` | `(eventName: SplineEventName, cb: (e: SplineEvent) => void) => void` | Remove an event listener for Spline events.                                                                                                        |
| `emitEvent`           | `(eventName: SplineEventName, nameOrUuid: string) => void`           | Triggers a Spline event associated to an object with provided name or uuid in reverse order. Starts from first state to last state.                |
| `emitEventReverse`    | `(eventName: SplineEventName, nameOrUuid: string) => void`           | Triggers a Spline event associated to an object with provided name or uuid in reverse order. Starts from last state to first state.                |
| `findObjectById`      | `(uuid: string) => SPEObject`                                        | Searches through scene's children and returns the object with that uuid.                                                                           |
| `findObjectByName`    | `(name: string) => SPEObject`                                        | Searches through scene's children and returns the first object with that name.                                                                     |
| `setZoom`             | `(zoom: number) => void`                                             | Sets the camera zoom, expects a number value > 0 where 1 is base zoom.                                                                             |
| `setSize`             | `(width: number, height: number) => void`                            | Sets the size of the application and canvas. When called, Spline will stop automatic size updates.                                                 |
| `setVariables`        | `(variables: Record<string, string \| number \| boolean>) => void`   | Updates values for passed variables by name.                                                                                                       |
| `setVariable`         | `(name: string, value: string \| number \| boolean) => void`         | Updates value for passed variable by name.                                                                                                         |
| `getVariables`        | `() => Record<string, string \| number \| boolean>`                  | Returns a record mapping variable names to their respective current values.                                                                        |
| `getVariable`         | `(name: string, value: string \| number \| boolean) => void`         | Get current value for a specific variable from its name.                                                                                           |
| `stop`                | `() => void`                                                         | Stop/Pause all rendering controls and events.                                                                                                      |
| `play`                | `() => void`                                                         | Play/Resume rendering, controls and events.                                                                                                        |
| `pauseGameControls`   | `() => void`                                                         | Stop/Pause Game Controls if any.                                                                                                                   |
| `resumeGameControls`  | `() => void`                                                         | Play/Resume Game Controls if any.                                                                                                                  |
| `setBackgroundColor`  | `(color:string) => void`                                             | Manually sets the scene/canvas background color with a css color value.                                                                            |
| `getAllObjects`       | `() => SPEObject[]`                                                  | Returns a flat list of all the objects present in the scene.                                                                                       |
| `getSplineEvents`     | `() => Object[]`                                                     | Returns an array listing all the Spline events used in the scene.                                                                                  |
| `swapGeometry`        | `(target: string, content: string \| Uint8Array) => Promise<void>`   | Replace the geometry from target if it is a mesh. Target parameter can be object name or uuid. Content parameter is url to `.splinegeometry` file. |

### Spline Objects Methods and Properties

After retrieving a Spline Object with `app.findObjectById` or `app.findObjectByName`, there are a variety of properties and methods you can call on those.

| Name        | Type                        | Description                                                                                                                                              |
| ----------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `position`  | `Vector3`                   | Gets / Sets object position.                                                                                                                             |
| `rotation`  | `Vector3`                   | Gets / Sets object position.                                                                                                                             |
| `scale`     | `Vector3`                   | Gets / Sets object scale.                                                                                                                                |
| `visible`   | `boolean`                   | Gets / Sets object vibility.                                                                                                                             |
| `state`     | `string\|number\|undefined` | Gets / Sets object's current state by name. undefined is used for default / Base State. You can also set from state index (0, 1, 2 etc...).              |
| `intensity` | `number`                    | Only for light objects. Used to change the light intensity.                                                                                              |
| `material`  | `Material`                  | Only for mesh objects. Gives access to the object's material API.                                                                                        |
| `color`     | `string` (CSS like color)   | Sets color of a light or a mesh material if it has a color layer. If not color layer is present it will try to create one at the top of the layer stack. |

| Name         | Type                                   | Description                                                      |
| ------------ | -------------------------------------- | ---------------------------------------------------------------- |
| `show`       | `() => void`                           | Change object visible property to true.                          |
| `hide`       | `() => void`                           | Change object visible property to false.                         |
| `emitEvent`  | `(eventName: SplineEventName) => void` | Force trigger an event defined in Spline Editor.                 |
| `transition` | `(params: TransitionParams) => void`   | Used to procedurally trigger a Spline transition between states. |

### Spline Events

These are all the Spline event types that you can pass to the `addEventListener`, `emitEvent` and `emitEventReverse` function.

| Name         | Description                                   |
| ------------ | --------------------------------------------- |
| `mouseDown`  | Refers to the Spline `Mouse Down` event type  |
| `mouseHover` | Refers to the Spline `Mouse Hover` event type |
| `mouseUp`    | Refers to the Spline `Mouse Up` event type    |
| `keyDown`    | Refers to the Spline `Key Down` event type    |
| `keyUp`      | Refers to the Spline `Key Up` event type      |
| `start`      | Refers to the Spline `Start` event type       |
| `lookAt`     | Refers to the Spline `Look At` event type     |
| `follow`     | Refers to the Spline `Mouse Up` event type    |
| `scroll`     | Refers to the Spline `Scroll` event type      |

### Spline Materials

When accessing an object's material its possible to change each of its layer's parameters.

| Name     | Type      | Description                                                 |
| -------- | --------- | ----------------------------------------------------------- |
| `layers` | `Layer[]` | Gives access to the list of layers for this material        |
| `alpha`  | `number`  | Gets/Sets global opacity for this material. Between 0 and 1 |

### Spline Material Layers

Each layer has an immutable type property which can be :

- `color`
- `fresnel`
- `rainbow`
- `normal`
- `gradient`
- `depth`
- `texture`
- `video`
- `noise`
- `toon`
- `outline`
- `transmission`
- `matcap`
- `pattern`
- `displace`.

#### Color Layer

| Name    | Type     | Description                                              |
| ------- | -------- | -------------------------------------------------------- |
| `type`  | `color`  | Read only                                                |
| `color` | `string` | CSS like string color like `#FF0000` or `rgb(255, 0, 1)` |
| `alpha` | `number` | Opacity for this layer. Between 0 and 1                  |

#### Fresnel Layer

| Name        | Type      | Description                                              |
| ----------- | --------- | -------------------------------------------------------- |
| `type`      | `fresnel` | Read only                                                |
| `color`     | `string`  | CSS like string color like `#FF0000` or `rgb(255, 0, 1)` |
| `alpha`     | `number`  | Opacity for this layer. Between 0 and 1                  |
| `bias`      | `number`  | Shifts the fresnel effect towards or away from the edges |
| `intensity` | `number`  | Strength of the fresnel effect                           |
| `factor`    | `number`  | Controls the falloff/sharpness of the fresnel effect     |

#### Rainbow Layer

| Name            | Type                       | Description                                           |
| --------------- | -------------------------- | ----------------------------------------------------- |
| `type`          | `rainbow`                  | Read only                                             |
| `alpha`         | `number`                   | Opacity for this layer. Between 0 and 1               |
| `filmThickness` | `number`                   | Controls the thickness of the thin film effect        |
| `movement`      | `number`                   | Controls the animation movement of the rainbow effect |
| `wavelengths`   | `[number, number, number]` | RGB wavelength values for the rainbow effect          |
| `noiseStrength` | `number`                   | Strength of the noise applied to the rainbow          |
| `noiseScale`    | `number`                   | Scale of the noise pattern                            |
| `offset`        | `[number, number, number]` | XYZ offset for the rainbow effect                     |

#### Normal Layer

| Name      | Type                       | Description                             |
| --------- | -------------------------- | --------------------------------------- |
| `type`    | `normal`                   | Read only                               |
| `alpha`   | `number`                   | Opacity for this layer. Between 0 and 1 |
| `cnormal` | `[number, number, number]` | Custom normal direction values          |

#### Gradient Layer

Please note that you cannot add or remove colors to the gradient layer at runtime, you can only mutate the existing colors.

| Name           | Type               | Description                                      |
| -------------- | ------------------ | ------------------------------------------------ |
| `type`         | `gradient`         | Read only                                        |
| `alpha`        | `number`           | Opacity for this layer. Between 0 and 1          |
| `gradientType` | `GradientType`     | Type of gradient: `Linear`, `Radial`, or `Polar` |
| `smooth`       | `boolean`          | Whether the gradient transitions are smooth      |
| `colors`       | `string[]`         | Array of CSS color strings for gradient stops    |
| `steps`        | `number[]`         | Position of each color stop (0 to 1)             |
| `angle`        | `number`           | Rotation angle of the gradient                   |
| `offset`       | `[number, number]` | XY offset for the gradient                       |
| `morph`        | `[number, number]` | Morph values for gradient distortion             |

#### Depth Layer

Please note that you cannot add or remove colors to the depth layer at runtime, you can only mutate the existing colors.

| Name           | Type                       | Description                                      |
| -------------- | -------------------------- | ------------------------------------------------ |
| `type`         | `depth`                    | Read only                                        |
| `alpha`        | `number`                   | Opacity for this layer. Between 0 and 1          |
| `gradientType` | `GradientType`             | Type of gradient: `Linear`, `Radial`, or `Polar` |
| `smooth`       | `boolean`                  | Whether the depth transitions are smooth         |
| `isVector`     | `boolean`                  | Whether to use vector-based depth calculation    |
| `isWorldSpace` | `boolean`                  | Whether depth is calculated in world space       |
| `origin`       | `[number, number, number]` | Origin point for depth calculation               |
| `direction`    | `[number, number, number]` | Direction vector for depth calculation           |
| `colors`       | `string[]`                 | Array of CSS color strings for depth stops       |
| `steps`        | `number[]`                 | Position of each color stop (0 to 1)             |
| `near`         | `number`                   | Near clipping distance                           |
| `far`          | `number`                   | Far clipping distance                            |

#### Texture Layer

| Name            | Type                                           | Description                                                                                  |
| --------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `type`          | `texture`                                      | Read only                                                                                    |
| `alpha`         | `number`                                       | Opacity for this layer. Between 0 and 1                                                      |
| `projection`    | `ProjectionType`                               | Projection type: `UV`, `Planar`, `Spherical`, `Cylindrical`, or `Triplanar`                  |
| `size`          | `[number, number]`                             | Size of the texture                                                                          |
| `blending`      | `number`                                       | Blending mode value                                                                          |
| `axis`          | `Axis`                                         | Projection axis: `x`, `y`, or `z`                                                            |
| `side`          | `Side`                                         | Which side to render: `Front`, `Back`, or `Double`                                           |
| `crop`          | `boolean`                                      | Whether to crop the texture                                                                  |
| `texture`       | `Texture`                                      | The texture object containing image, wrapping, repeat, offset, rotation, and filter settings |
| `updateTexture` | `(src: string \| Uint8Array) => Promise<void>` | Updates the texture with a new image source                                                  |

#### Video Layer

| Name            | Type                                           | Description                                                                 |
| --------------- | ---------------------------------------------- | --------------------------------------------------------------------------- |
| `type`          | `video`                                        | Read only                                                                   |
| `alpha`         | `number`                                       | Opacity for this layer. Between 0 and 1                                     |
| `projection`    | `ProjectionType`                               | Projection type: `UV`, `Planar`, `Spherical`, `Cylindrical`, or `Triplanar` |
| `size`          | `[number, number]`                             | Size of the video                                                           |
| `blending`      | `number`                                       | Blending mode value                                                         |
| `axis`          | `Axis`                                         | Projection axis: `x`, `y`, or `z`                                           |
| `side`          | `Side`                                         | Which side to render: `Front`, `Back`, or `Double`                          |
| `crop`          | `boolean`                                      | Whether to crop the video                                                   |
| `texture`       | `Texture`                                      | The texture object for the video                                            |
| `updateTexture` | `(src: string \| Uint8Array) => Promise<void>` | Updates the video texture with a new source                                 |

#### Noise Layer

| Name           | Type                       | Description                                                                                 |
| -------------- | -------------------------- | ------------------------------------------------------------------------------------------- |
| `type`         | `noise`                    | Read only                                                                                   |
| `alpha`        | `number`                   | Opacity for this layer. Between 0 and 1                                                     |
| `noiseType`    | `NoiseType`                | Type of noise: `Simplex`, `SimplexFractal`, `Ashima`, `Fbm`, `Perlin`, or `Voronoi`         |
| `scale`        | `number`                   | Overall scale of the noise                                                                  |
| `size`         | `[number, number, number]` | XYZ size of the noise pattern                                                               |
| `move`         | `number`                   | Animation movement speed                                                                    |
| `colorA`       | `string`                   | First color for the noise gradient                                                          |
| `colorB`       | `string`                   | Second color for the noise gradient                                                         |
| `colorC`       | `string`                   | Third color for the noise gradient                                                          |
| `colorD`       | `string`                   | Fourth color for the noise gradient                                                         |
| `distortion`   | `[number, number]`         | Distortion values                                                                           |
| `fA`           | `[number, number]`         | Frequency A parameters                                                                      |
| `fB`           | `[number, number]`         | Frequency B parameters                                                                      |
| `voronoiStyle` | `VoronoiStyle`             | Voronoi style: `F1`, `F2`, `F2MinusF1`, `SmoothBlend`, `Edge`, `Power`, `Lines`, or `Cells` |
| `highCut`      | `number`                   | High cut threshold                                                                          |
| `lowCut`       | `number`                   | Low cut threshold                                                                           |
| `smoothness`   | `number`                   | Smoothness of the noise                                                                     |
| `seed`         | `number`                   | Random seed for noise generation                                                            |
| `quality`      | `number`                   | Quality/resolution of the noise                                                             |

#### Toon Layer

| Name            | Type                       | Description                                        |
| --------------- | -------------------------- | -------------------------------------------------- |
| `type`          | `toon`                     | Read only                                          |
| `alpha`         | `number`                   | Opacity for this layer. Between 0 and 1            |
| `positioning`   | `ToonType`                 | Toon shading type: `Lights`, `Static`, or `Camera` |
| `colors`        | `string[]`                 | Array of CSS color strings for toon shading bands  |
| `steps`         | `number[]`                 | Position of each color step (0 to 1)               |
| `source`        | `[number, number, number]` | Light source position                              |
| `isWorldSpace`  | `boolean`                  | Whether calculations are in world space            |
| `noiseStrength` | `number`                   | Strength of noise applied to the toon shading      |
| `noiseScale`    | `number`                   | Scale of the noise pattern                         |
| `shadowColor`   | `string`                   | CSS color string for shadows                       |
| `offset`        | `[number, number, number]` | XYZ offset for the toon effect                     |

#### Outline Layer

| Name               | Type                       | Description                               |
| ------------------ | -------------------------- | ----------------------------------------- |
| `type`             | `outline`                  | Read only                                 |
| `alpha`            | `number`                   | Opacity for this layer. Between 0 and 1   |
| `outlineColor`     | `string`                   | CSS color string for the outline          |
| `contourColor`     | `string`                   | CSS color string for the contour lines    |
| `outlineWidth`     | `number`                   | Width of the outline                      |
| `contourWidth`     | `number`                   | Width of the contour lines                |
| `outlineThreshold` | `number`                   | Threshold for outline detection           |
| `contourThreshold` | `number`                   | Threshold for contour detection           |
| `outlineSmoothing` | `number`                   | Smoothing applied to the outline          |
| `contourFrequency` | `number`                   | Frequency of contour lines                |
| `contourDirection` | `[number, number, number]` | Direction vector for contour lines        |
| `positionalLines`  | `boolean`                  | Whether to use positional contour lines   |
| `compensation`     | `boolean`                  | Whether to apply perspective compensation |

#### Transmission Layer

| Name        | Type           | Description                                   |
| ----------- | -------------- | --------------------------------------------- |
| `type`      | `transmission` | Read only                                     |
| `alpha`     | `number`       | Opacity for this layer. Between 0 and 1       |
| `thickness` | `number`       | Thickness of the transmissive material        |
| `ior`       | `number`       | Index of refraction                           |
| `roughness` | `number`       | Surface roughness affecting transmission blur |

#### Matcap Layer

| Name            | Type                                           | Description                                        |
| --------------- | ---------------------------------------------- | -------------------------------------------------- |
| `type`          | `matcap`                                       | Read only                                          |
| `texture`       | `Texture`                                      | The matcap texture object                          |
| `updateTexture` | `(src: string \| Uint8Array) => Promise<void>` | Updates the matcap texture with a new image source |

#### Pattern Layer

| Name         | Type               | Description                                                                                       |
| ------------ | ------------------ | ------------------------------------------------------------------------------------------------- |
| `type`       | `pattern`          | Read only                                                                                         |
| `alpha`      | `number`           | Opacity for this layer. Between 0 and 1                                                           |
| `style`      | `PatternStyle`     | Pattern style: `Circle`, `Ring`, `Polygon`, `Cross`, `Diamond`, `Checkerboard`, `Line`, or `Wave` |
| `projection` | `ProjectionType`   | Projection type: `UV`, `Planar`, `Spherical`, `Cylindrical`, or `Triplanar`                       |
| `axis`       | `Axis`             | Projection axis: `x`, `y`, or `z`                                                                 |
| `blending`   | `number`           | Blending mode value                                                                               |
| `offset`     | `[number, number]` | XY offset for the pattern                                                                         |
| `colorA`     | `string`           | First pattern color                                                                               |
| `colorB`     | `string`           | Second pattern color                                                                              |
| `frequency`  | `[number, number]` | Pattern repeat frequency                                                                          |
| `size`       | `number`           | Size of the pattern elements                                                                      |
| `variation`  | `number`           | Variation in the pattern                                                                          |
| `smoothness` | `number`           | Smoothness of pattern edges                                                                       |
| `zigzag`     | `number`           | Zigzag amount for applicable patterns                                                             |
| `rotation`   | `number`           | Rotation angle of the pattern                                                                     |
| `vertical`   | `[number, number]` | Vertical pattern parameters                                                                       |
| `horizontal` | `[number, number]` | Horizontal pattern parameters                                                                     |
| `sides`      | `number`           | Number of sides for polygon patterns                                                              |

#### Displace Layer

Displace layers come in two types: `map` and `noise`. Please note that it's not possible to change the `displacementType` at runtime.

##### Map Displace Layer

| Name               | Type       | Description                                            |
| ------------------ | ---------- | ------------------------------------------------------ |
| `type`             | `displace` | Read only                                              |
| `displacementType` | `map`      | Read only - indicates this is a map-based displacement |
| `intensity`        | `number`   | Intensity of the displacement effect                   |
| `crop`             | `boolean`  | Whether to crop the displacement map                   |

##### Noise Displace Layer

| Name               | Type                       | Description                                                                                 |
| ------------------ | -------------------------- | ------------------------------------------------------------------------------------------- |
| `type`             | `displace`                 | Read only                                                                                   |
| `displacementType` | `noise`                    | Read only - indicates this is a noise-based displacement                                    |
| `intensity`        | `number`                   | Intensity of the displacement effect                                                        |
| `noiseType`        | `NoiseType`                | Type of noise: `Simplex`, `SimplexFractal`, `Ashima`, `Fbm`, `Perlin`, or `Voronoi`         |
| `scale`            | `number`                   | Scale of the noise                                                                          |
| `movement`         | `number`                   | Animation movement speed                                                                    |
| `offset`           | `[number, number, number]` | XYZ offset for the noise                                                                    |
| `voronoiStyle`     | `VoronoiStyle`             | Voronoi style: `F1`, `F2`, `F2MinusF1`, `SmoothBlend`, `Edge`, `Power`, `Lines`, or `Cells` |
| `smoothness`       | `number`                   | Smoothness of the noise                                                                     |
| `seed`             | `number`                   | Random seed for noise generation                                                            |
| `highCut`          | `number`                   | High cut threshold                                                                          |
| `lowCut`           | `number`                   | Low cut threshold                                                                           |
| `quality`          | `number`                   | Quality/resolution of the noise                                                             |

### Spline Light Layers

Light layers define how mesh objects interact with lights in the scene. Each material can have one light layer that determines its shading model.

#### Phong Light Layer

| Name               | Type     | Description                                              |
| ------------------ | -------- | -------------------------------------------------------- |
| `type`             | `light`  | Read only                                                |
| `category`         | `phong`  | Read only                                                |
| `specular`         | `RGB`    | Specular highlight color as `{ r, g, b }` (values 0-255) |
| `shininess`        | `number` | Shininess/glossiness of the specular highlight           |
| `bumpMapIntensity` | `number` | Intensity of the bump map effect on this material        |

#### Lambert Light Layer

| Name               | Type      | Description                                         |
| ------------------ | --------- | --------------------------------------------------- |
| `type`             | `light`   | Read only                                           |
| `category`         | `lambert` | Read only                                           |
| `emissive`         | `RGB`     | Emissive (self-illumination) color as `{ r, g, b }` |
| `bumpMapIntensity` | `number`  | Intensity of the bump map effect on this material   |

#### Toon Light Layer

| Name               | Type     | Description                                              |
| ------------------ | -------- | -------------------------------------------------------- |
| `type`             | `light`  | Read only                                                |
| `category`         | `toon`   | Read only                                                |
| `specular`         | `RGB`    | Specular highlight color as `{ r, g, b }` (values 0-255) |
| `shininess`        | `number` | Shininess/glossiness of the specular highlight           |
| `bumpMapIntensity` | `number` | Intensity of the bump map effect on this material        |

#### Standard (Physical) Light Layer

| Name               | Type       | Description                                                           |
| ------------------ | ---------- | --------------------------------------------------------------------- |
| `type`             | `light`    | Read only                                                             |
| `category`         | `physical` | Read only                                                             |
| `roughness`        | `number`   | Surface roughness (0 = mirror-like, 1 = fully rough)                  |
| `metalness`        | `number`   | How metallic the surface appears (0 = dielectric, 1 = fully metallic) |
| `reflectivity`     | `number`   | Reflectivity of the surface for non-metallic materials                |
| `bumpMapIntensity` | `number`   | Intensity of the bump map effect on this material                     |

#### Basic Light Layer

In Spline editor the basic layer correspond to an hidden light layer (ie no lighting).

| Name               | Type     | Description                                       |
| ------------------ | -------- | ------------------------------------------------- |
| `type`             | `light`  | Read only                                         |
| `category`         | `basic`  | Read only                                         |
| `bumpMapIntensity` | `number` | Intensity of the bump map effect on this material |

© 2025 Spline, Inc.
