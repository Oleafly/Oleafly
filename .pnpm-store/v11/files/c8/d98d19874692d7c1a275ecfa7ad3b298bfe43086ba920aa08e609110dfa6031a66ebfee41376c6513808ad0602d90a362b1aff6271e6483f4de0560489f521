declare module '@splinetool/runtime' {
	export type RGB = { r: number; g: number; b: number };
	export type SplineEvent = {
		target: {
			name: string;
			id: string;
		};
	};

	export enum Easing {
		LINEAR = 0,
		EASE = 1,
		EASE_IN = 2,
		EASE_OUT = 3,
		EASE_IN_OUT = 4,
		CUBIC = 5,
		SPRING = 6,
	}

	export type SplineEventName =
		| 'mouseDown'
		| 'mouseUp'
		| 'mouseHover'
		| 'keyDown'
		| 'keyUp'
		| 'start'
		| 'lookAt'
		| 'follow'
		| 'scroll'
		| 'collision'
		| 'rendered';

	export type TransitionChainParams = {
		/**
		 * When set, the transition will start from this state. If undefined (or not set) it will start from current state in the timeline.
		 * When null it will start from the Base State / default state.
		 */
		from?: string | null;
		to: string | null;
		duration?: number;
		delay?: number;
	} & EasingData;

	export type TransitionParams = TransitionChainParams & {
		autoPlay?: boolean;
	};

	export type TransitionFactory = {
		transition: (params: TransitionChainParams) => TransitionFactory;
		/**
		 * Starts the transition.
		 */
		play: () => TransitionFactory;
		/**
		 * Pauses the transition.
		 */
		pause: () => TransitionFactory;
		/**
		 * Resets the transition.
		 */
		reset: () => TransitionFactory;
		/**
		 * Seeks the transition to a specific time.
		 * @param ms The time in milliseconds.
		 */
		seek: (ms: number) => TransitionFactory;
	};

	export type SPEObject = {
		name: string;
		uuid: string;
		visible: boolean;
		intensity: number;
		position: { x: number; y: number; z: number };
		rotation: { x: number; y: number; z: number };
		scale: { x: number; y: number; z: number };
		material?: Material;

		/**
		 * Sets the color of the object's material if it is a mesh and if it has a color layer.
		 * If it has no color layer, it adds one with the specified color at the top of the layer stack.
		 * If object is a light, it sets the color of the light.
		 * @param color The color in CSS format (e.g., "rgb(255, 0, 0)" or "#ff0000").
		 */
		color: string;

		/**
		 * Gets or sets the object's current state from a given state name or id. Default state value is undefined.
		 */
		state: string | number | undefined;
		/**
		 * Triggers a Spline event.
		 * Starts from firt state to last state.
		 * @param {string} eventName String that matches Spline event's name
		 * @param {string}	uuid String to match to the object's uuid
		 */
		emitEvent: (eventName: SplineEventName) => void;
		/**
		 * Triggers a Spline event in reverse order.
		 * Starts from last state to first state.
		 * @param {string} eventName String that matches Spline event's name
		 */
		emitEventReverse: (eventName: SplineEventName) => void;
		/**
		 * Hides the object.
		 * Equivalent to object.visible = false
		 */
		hide: () => void;
		/**
		 * Hides the object.
		 * Equivalent to object.visible = true
		 */
		show: () => void;

		transition: (params: TransitionParams) => TransitionFactory;
	};

	export class Application {
		_controls: any;
		renderOnDemand: boolean;

		canvas: HTMLCanvasElement;
		constructor(
			canvas: HTMLCanvasElement,
			{
				renderOnDemand,
			}?: {
				/**
				 * @deprecated use options.renderMode instead
				 */
				renderOnDemand?: boolean;

				/**
				 * Can either be:
				 * - `auto` runtime tries to only render when necessary (default).
				 * - `manual` only renders when spline.requestRender() is called.
				 * - `continuous` continuously render, once per frame.
				 */
				renderMode?: 'auto' | 'manual' | 'continuous';

				/**
				 * Path to the various WASM files used by the runtime.
				 * If not set the runtime will load the WASM files from the CDN.
				 */
				wasmPath?: string;
			}
		);
		/**
		 * Loads an exported Spline scene
		 * @param path the url pointing toward a .splinecode file
		 * @param variables a key:value object describing initial values of the variables in the file
		 */
		load(
			path: string,
			variables?: Record<string, string | number | boolean>,
			fetchOptions?: RequestInit
		): Promise<void>;
		/**
		 * Initializes the application starting from a binary encoded .splinecode file
		 * @param array the binary ArrayBuffer of the .splinecode
		 */
		start(
			array: ArrayBuffer,
			{
				interactive = true,
				variables,
			}?: {
				interactive?: boolean;
				variables?: Record<string, string | number | boolean>;
			}
		): void;
		/**
		 *  Searches through scene's children and returns the object with that uuid
		 * @param uuid	String to match to the object's uuid
		 * @returns SPEObject
		 */
		findObjectById(uuid: string): SPEObject | undefined;
		/**
		 * Searches through scene's children and returns the first object with that name
		 * @param  {string}	name
		 * @returns {Object} SPEObject
		 */
		findObjectByName(name: string): SPEObject | undefined;
		/**
		 * A flat list of all scene objects
		 * @returns {Array.<SPEObject>}
		 */
		getAllObjects(): SPEObject[];
		/**
		 * Returns an array of Spline events
		 * @returns {Array.<Object>}
		 */
		getSplineEvents(): {
			[key: string]: {
				[key: string]: CustomEvent<any>;
			};
		};
		/**
		 * Triggers a Spline event associated to an object with provided name or uuid.
		 * Starts from first state to last state.
		 * @param {string} eventName String that matches Spline event's name
		 * @param {string} nameOrUuid The name or uuid of the object
		 */
		emitEvent(eventName: SplineEventName, nameOrUuid: string): void;
		/**
		 * Triggers a Spline event associated to an object with provided name or uuid in reverse order.
		 * Starts from last state to first state.
		 * @param {string} eventName String that matches Spline event's name
		 * @param {string}	nameOrUuid The name or uuid of the object
		 */
		emitEventReverse(eventName: SplineEventName, nameOrUuid: string): void;
		/**
		 * Add an event listener for Spline events
		 * @param {string} eventName String that matches Spline event's name
		 * @param {function} cb	A callback function with Spline event as parameter
		 */
		addEventListener(
			eventName: SplineEventName,
			cb: (e: SplineEvent) => void
		): void;
		/**
		 * Removes the event listener for a Spline event with the same name and callback
		 * @param {string} eventName String that matches Spline event's name
		 * @param {function} cb	A callback function with Spline event as parameter
		 */
		removeEventListener(
			eventName: SplineEventName,
			cb: (e: SplineEvent) => void
		): void;
		/**
		 * Deactivates runtime
		 */
		dispose(): void;

		setZoom(zoomValue: number): void;

		/**
		 * Manually sets the scene/canvas background color with a css color value.
		 * @param color css color style
		 */
		setBackgroundColor(color: string): void;

		/**
		 * Change the event type to global when passing true and local when passing false
		 * @param global
		 */
		setGlobalEvents(global: boolean): void;

		/**
		 * Manually sets the canvas size to a specific value.
		 * When this is called, the canvas will no longer be
		 * automatically resized on window resize for full-screen mode.
		 * @param {number} width
		 * @param {number} height
		 */
		setSize(width: number, height: number): void;

		get data(): any;
		get eventManager(): any;
		get controls(): any;

		/**
		 * Returns true if spline.stop() was previously called
		 */
		get isStopped(): boolean;

		/**
		 * Stop/Pause all rendering controls and events
		 */
		stop(): void;

		/**
		 * Play/Resume rendering, controls and events
		 */
		play(): void;

		/**
		 * To be used concurrently with spline.renderMode = 'manual
		 * When called this function will flag the render to dirty which means that
		 * the scene will be rendered on next animation frame. Calling this more than once per frame will not trigger multiple render.
		 */
		requestRender(): void;

		/**
		 * Change value for multiple variables
		 * @param variables a key:value object describing values by name of the variables to update
		 */
		setVariables(variables: Record<string, number | boolean | string>): void;

		/**
		 * Change value for a specific variable
		 * @param name name of the variable to update
		 * @param value new value for this variable
		 */
		setVariable(name: string, value: number | boolean | string): void;

		/**
		 * Returns a record mapping variable names to their respective current values.
		 */
		getVariables(): Record<string, number | boolean | string>;

		/**
		 * Get current value for a specific variable from its name
		 * @param name name of the variable
		 */
		getVariable(name: string): number | boolean | string;

		/**
		 * Overrides the location of the wasm file for the UI library.
		 * @param url
		 */
		setUIWasmUrl(url: string): void;

		pauseGameControls(): void {}
		resumeGameControls(): void {}

		/**
		 * Swaps the geometry of an object with a new one from a URL
		 * @param objectNameOrId The name or uuid of the object to swap geometry
		 * @param url The URL of the new geometry (.splinegeometry file)
		 */
		swapGeometry(
			objectNameOrId: string,
			urlOrBuffer: string | Uint8Array
		): void {}
	}

	/* ================== MATERIALS ================== */
	/* ============================================== */

	/* ---------- COLOR LAYER ---------- */
	export type ColorLayer = {
		readonly type: 'color';
		alpha: number;
		color: string;
	};

	/* ---------- FRESNEL LAYER ---------- */
	export type FresnelLayer = {
		readonly type: 'fresnel';
		alpha: number;
		color: string;
		bias: number;
		intensity: number;
		factor: number;
	};

	/* ---------- RAINBOW LAYER ---------- */
	export type RainbowLayer = {
		readonly type: 'rainbow';
		alpha: number;
		filmThickness: number;
		movement: number;
		wavelengths: [number, number, number];
		noiseStrength: number;
		noiseScale: number;
		offset: [number, number, number];
	};

	/* ---------- NORMAL LAYER ---------- */
	export type NormalLayer = {
		readonly type: 'normal';
		alpha: number;
		cnormal: [number, number, number];
	};

	/* ---------- GRADIENT LAYER ---------- */
	export enum GradientType {
		Linear,
		Radial,
		Polar,
	}

	export type GradientLayer = {
		readonly type: 'gradient';
		alpha: number;
		gradientType: GradientType;
		smooth: boolean;
		colors: string[];
		steps: number[];
		angle: number;
		offset: [number, number];
		morph: [number, number];
	};

	/* ---------- DEPTH LAYER ---------- */
	export type DepthLayer = {
		readonly type: 'depth';
		alpha: number;
		gradientType: GradientType;
		smooth: boolean;
		isVector: boolean;
		isWorldSpace: boolean;
		origin: [number, number, number];
		direction: [number, number, number];
		colors: string[];
		steps: number[];
		near: number;
		far: number;
	};

	/* ---------- TEXTURE LAYER ---------- */
	export enum Wrapping {
		RepeatWrapping = 1000,
		ClampToEdgeWrapping = 1001,
		MirroredRepeatWrapping = 1002,
	}

	export enum TextureFilter {
		NearestFilter = 1003,
		LinearFilter = 1006,
		LinearMipmapLinearFilter = 1008,
	}

	export enum ProjectionType {
		UV,
		Planar,
		Spherical,
		Cylindrical,
		Triplanar,
	}

	export enum Axis {
		x = 'x',
		y = 'y',
		z = 'z',
	}

	export enum Side {
		Front,
		Back,
		Double,
	}

	export type Image = {
		data: string | Uint8Array;
		readonly name: string;
	};

	export type Texture = {
		image: Image;
		wrapping: Wrapping;
		repeat: [number, number];
		offset: [number, number];
		rotation?: number;
		minFilter: TextureFilter;
		magFilter: TextureFilter;
	};

	export type TextureLayer = {
		readonly type: 'texture';
		alpha: number;
		projection: ProjectionType;
		size: [number, number];
		blending: number;
		axis: Axis;
		side: Side;
		crop: boolean;
		texture: Texture;
		updateTexture(src: string | Uint8Array): Promise<void>;
	};

	/* ---------- VIDEO LAYER ---------- */
	export type Video = {
		readonly type: 'video';
		data: string | Uint8Array;
		thumb: string | Uint8Array;
		name: string;
	};

	export type VideoTexture = Omit<Texture, 'image'> & {
		video: Video;
	};

	export type VideoLayer = {
		readonly type: 'video';
		alpha: number;
		projection: ProjectionType;
		size: [number, number];
		blending: number;
		axis: Axis;
		side: Side;
		crop: boolean;
		texture: Texture;
		updateTexture(src: string | Uint8Array): Promise<void>;
	};

	/* ---------- NOISE LAYER ---------- */
	export enum NoiseType {
		Simplex,
		SimplexFractal,
		Ashima,
		Fbm,
		Perlin,
		Voronoi,
	}

	export enum VoronoiStyle {
		F1,
		F2,
		F2MinusF1,
		SmoothBlend,
		Edge,
		Power,
		Lines,
		Cells,
	}

	export type NoiseLayer = {
		readonly type: 'noise';
		alpha: number;
		noiseType: NoiseType;
		scale: number;
		size: [number, number, number];
		move: number;
		colorA: string;
		colorB: string;
		colorC: string;
		colorD: string;
		distortion: [number, number];
		fA: [number, number];
		fB: [number, number];
		voronoiStyle: VoronoiStyle;
		highCut: number;
		lowCut: number;
		smoothness: number;
		seed: number;
		quality: number;
	};

	/* ---------- TOON LAYER ---------- */
	export enum ToonType {
		Lights,
		Static,
		Camera,
	}

	export type ToonLayer = {
		readonly type: 'toon';
		alpha: number;
		positioning: ToonType;
		colors: string[];
		steps: number[];
		source: [number, number, number];
		isWorldSpace: boolean;
		noiseStrength: number;
		noiseScale: number;
		shadowColor: string;
		offset: [number, number, number];
	};

	/* ---------- OUTLINE LAYER ---------- */
	export type OutlineLayer = {
		readonly type: 'outline';
		alpha: number;
		outlineColor: string;
		contourColor: string;
		outlineWidth: number;
		contourWidth: number;
		outlineThreshold: number;
		contourThreshold: number;
		outlineSmoothing: number;
		contourFrequency: number;
		contourDirection: [number, number, number];
		positionalLines: boolean;
		compensation: boolean;
	};

	/* ---------- TRANSMISSION LAYER ---------- */
	export type TransmissionLayer = {
		readonly type: 'transmission';
		alpha: number;
		thickness: number;
		ior: number;
		roughness: number;
	};

	/* ---------- MATCAP LAYER ---------- */
	export type MatcapLayer = {
		readonly type: 'matcap';
		texture: Texture;
		updateTexture(src: string | Uint8Array): Promise<void>;
	};

	/* ---------- PATTERN LAYER ---------- */
	export enum PatternStyle {
		Circle,
		Ring,
		Polygon,
		Cross,
		Diamond,
		Checkerboard,
		Line,
		Wave,
	}

	export type PatternLayer = {
		readonly type: 'transmission';
		alpha: number;
		style: PatternStyle;
		projection: ProjectionType;
		axis: Axis;
		blending: number;
		offset: [number, number];
		colorA: string;
		colorB: string;
		frequency: [number, number];
		size: number;
		variation: number;
		smoothness: number;
		zigzag: number;
		rotation: number;
		vertical: [number, number];
		horizontal: [number, number];
		sides: number;
	};

	/* ---------- DISPLACE LAYER ---------- */
	export type AbstractDisplaceLayer<T extends string> =
		AbstractVertexLayer<'displace'> & {
			readonly displacementType: T;
		};

	export type MapDisplaceLayer = {
		readonly type: 'displace';
		readonly displacementType: 'map';
		intensity: number;
		crop: boolean;
	};
	export type NoiseDisplaceLayer = {
		readonly type: 'displace';
		readonly displacementType: 'noise';
		intensity: number;
		noiseType: NoiseType;
		scale: number;
		movement: number;
		offset: [number, number, number];
		voronoiStyle: VoronoiStyle;
		smoothness: number;
		seed: number;
		highCut: number;
		lowCut: number;
		quality: number;
	};
	export type DisplaceLayer = MapDisplaceLayer | NoiseDisplaceLayer;

	/* ---------- LIGHT LAYERS ---------- */
	export type BasicLightLayer = {
		readonly type: 'light';
		readonly category: 'basic';
		bumpMapIntensity: number;
	};
	export type PhongLightLayer = {
		readonly type: 'light';
		readonly category: 'phong';
		specular: Sharable<RGB>;
		shininess: number;
		bumpMapIntensity: number;
	};

	export type ToonLightLayer = {
		readonly type: 'light';
		readonly category: 'toon';
		specular: Sharable<RGB>;
		shininess: number;
		bumpMapIntensity: number;
	};
	export type LambertLightLayer = {
		readonly type: 'light';
		readonly category: 'lambert';
		emissive: Sharable<RGB>;
		bumpMapIntensity: number;
	};
	export type StandardLightLayer = {
		readonly type: 'light';
		readonly category: 'physical';
		roughness: number;
		metalness: number;
		reflectivity: number;
		bumpMapIntensity: number;
	};

	/* ------------------------------------ */

	export type Layer =
		| ColorLayer
		| FresnelLayer
		| RainbowLayer
		| NormalLayer
		| GradientLayer
		| DepthLayer
		| TextureLayer
		| VideoLayer
		| NoiseLayer
		| ToonLayer
		| OutlineLayer
		| TransmissionLayer
		| MatcapLayer
		| PatternLayer
		| DisplaceLayer
		| BasicLightLayer
		| PhongLightLayer
		| LambertLightLayer
		| StandardLightLayer
		| ToonLightLayer
		| StandardLightLayer;

	export type Material = {
		layers: Layer[];
		alpha: number;
	};
}
