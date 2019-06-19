
import {
	VERSION,
	CAMERA_DYNAMIC,
	FACE_WALLS, FACE_SCRAPS, FEATURE_TRACES, SURVEY_WARNINGS,
	LEG_CAVE, LEG_SPLAY, LEG_SURFACE, LABEL_STATION, LABEL_STATION_COMMENT,
	SHADING_SINGLE, SHADING_RELIEF, SHADING_PATH, SHADING_DISTANCE,
	FEATURE_BOX, FEATURE_ENTRANCES, FEATURE_TERRAIN, FEATURE_STATIONS,
	VIEW_ELEVATION_N, VIEW_ELEVATION_S, VIEW_ELEVATION_E, VIEW_ELEVATION_W, VIEW_PLAN, VIEW_NONE,
	MOUSE_MODE_ROUTE_EDIT, MOUSE_MODE_NORMAL, MOUSE_MODE_DISTANCE, MOUSE_MODE_TRACE_EDIT, MOUSE_MODE_ENTRANCES, MOUSE_MODE_ANNOTATE, FEATURE_ANNOTATIONS
} from '../core/constants';

import { HUD } from '../hud/HUD';
import { Materials } from '../materials/Materials';
import { CameraManager } from './CameraManager';
import { LightingManager } from './LightingManager';
import { CameraMove } from './CameraMove';
import { CaveLoader } from '../loaders/CaveLoader';
import { Survey } from './Survey';
import { StationPopup } from './StationPopup';
import { WebTerrain } from '../terrain/WebTerrain';
import { CommonTerrain } from '../terrain/CommonTerrain';
import { Cfg } from '../core/lib';
import { WorkerPool } from '../core/WorkerPool';
import { defaultView, dynamicView, ViewState } from './ViewState';

// import { Annotations } from './Annotations';

import { OrbitControls } from '../ui/OrbitControls';
import { DeviceOrientationControls } from '../ui/DeviceOrientationControls';

import {
	EventDispatcher,
	Vector2, Vector3, Matrix4, Euler, Quaternion,
	Scene, Raycaster,
	LinearFilter, NearestFilter, RGBAFormat,
	OrthographicCamera,
	WebGLRenderer, WebGLRenderTarget,
	//	WebGLMultisampleRenderTarget,
	MOUSE, FogExp2
} from '../Three';

var renderer;

const scene = new Scene();
const fog = new FogExp2( Cfg.themeValue( 'background' ), 0.0025 );
const mouse = new Vector2();
const raycaster = new Raycaster();

const formatters = {};

const RETILE_TIMEOUT = 80; // ms pause after last movement before attempting retiling

var caveIsLoaded = false;

var container;
var defaultRenderTarget = null;

var cameraManager;
var lightingManager;

var lastMouseMode = MOUSE_MODE_NORMAL;
var mouseMode = MOUSE_MODE_NORMAL;
var mouseTargets = [];
var clickCount = 0;

var terrain = null;
var survey;
var limits = null;
var stats = {};
var zScale;
var caveLoader;

var cursorHeight;
var eyeSeparation = 0.5;

var shadingMode = SHADING_SINGLE;
var surfaceShadingMode = SHADING_SINGLE;
var terrainShadingMode = SHADING_RELIEF;

var useFog = false;

var cameraMode;
var selectedSection = null;

var controls;
var orientationControls;

var renderRequired = true;

var cameraMove;

var lastActivityTime = 0;
var timerId = null;

var popup = null;

var activeRenderer;
var clipped = false;

// preallocated tmp objects

const __rotation = new Euler();
const __q = new Quaternion();
const __v = new Vector3();

const Viewer = Object.create( EventDispatcher.prototype );

var viewState;
var savedView = {};

function init ( domID, configuration ) { // public method

	console.log( 'CaveView v' + VERSION );
	/*
	if ( 'serviceWorker' in navigator ) {

		navigator.serviceWorker.register( '/sw.js' ).then( function ( registration ) {

			// Registration was successful
			console.log( 'ServiceWorker registration successful with scope: ', registration.scope );

		}, function ( err ) {

			// registration failed :(
			console.log( 'ServiceWorker registration failed: ', err );

		} );

	}
	*/

	container = document.getElementById( domID );

	if ( ! container ) alert( 'No container DOM object [' + domID + '] available' );

	Cfg.set( configuration );

	const width  = container.clientWidth;
	const height = container.clientHeight;

	var canvas = document.createElement( 'canvas' );
	var context = canvas.getContext( 'webgl2', { antialias: false , stencil: true } );

	renderer = new WebGLRenderer( { canvas: canvas, context: context } );
	// renderer = new WebGLRenderer( { antialias: false });
	renderer.setSize( width, height );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setClearColor( Cfg.themeValue( 'background' ) );
	renderer.autoClear = false;

	/*
	var size = renderer.getDrawingBufferSize( new Vector2() );
	var parameters = {
		format: RGBAFormat,
		stencilBuffer: true
	};

	defaultRenderTarget = new WebGLMultisampleRenderTarget( Math.round( size.width ), Math.round( size.height ), parameters );

	defaultRenderTarget.targetCanvas = true;
	defaultRenderTarget.targetCanvasMask = renderer.context.COLOR_BUFFER_BIT;
	*/

	renderer.setRenderTarget( defaultRenderTarget );

	activeRenderer = renderer.render.bind( renderer );

	cameraManager = new CameraManager( container, renderer, scene );

	scene.fog = fog;
	scene.name = 'CV.Viewer';

	// setup lighting
	lightingManager = new LightingManager( scene );

	raycaster.params.Points.threshold = 2;

	renderer.clear();

	container.appendChild( renderer.domElement );

	controls = new OrbitControls( cameraManager, renderer.domElement, Cfg.value( 'avenControls', true ) );
	cameraMove = new CameraMove( controls, cameraMoved );

	controls.addEventListener( 'change', cameraMoved );
	controls.addEventListener( 'end', onCameraMoveEnd );

	controls.maxPolarAngle = Cfg.themeAngle( 'maxPolarAngle' );

	if ( 'geolocation' in navigator ) {

		console.log( 'has location' );

		orientationControls = new DeviceOrientationControls( cameraManager, cameraMove );

		orientationControls.addEventListener( 'change', cameraMoved );
		orientationControls.addEventListener( 'end', onCameraMoveEnd );

	}

	// event handler
	window.addEventListener( 'resize', resize );

	Object.defineProperties( Viewer, {

		'container': {
			value: container
		},

		'reset': {
			writeable: true,
			set: function () { setupView( false ); }
		},

		'surveyLoaded': {
			get: function () { return caveIsLoaded; }
		},

		'terrain': {
			writeable: true,
			get: function () { return cameraManager.testCameraLayer( FEATURE_TERRAIN ); },
			set: loadTerrain
		},

		'terrainShading': {
			writeable: true,
			get: function () { return terrainShadingMode; },
			set: function ( x ) { _stateSetter( setTerrainShadingMode, 'terrainShading', x ); }
		},

		'hasTerrain': {
			get: function () { return !! terrain; }
		},

		'hasRealTerrain': {
			get: function () { return ( terrain && ! terrain.isFlat ); }
		},

		'terrainAttributions': {
			get: function () { return terrain.attributions; }
		},

		'terrainDirectionalLighting': {
			writeable: true,
			get: function () { return lightingManager.directionalLighting; },
			set: setTerrainLighting
		},

		'terrainShadingModes': {
			get: function () { return terrain.terrainShadingModes; }
		},

		'terrainTileSet': {
			get: function () { return terrain.tileSet.bind( terrain ); }
		},

		'terrainDatumShift': {
			writeable: true,
			get: function () { return !! terrain.activeDatumShift; },
			set: applyTerrainDatumShift
		},

		'terrainOpacity': {
			writeable: true,
			get: function () { return ( terrain !== null ) ? terrain.getOpacity() : 0; },
			set: setTerrainOpacity
		},

		'shadingMode': {
			writeable: true,
			get: function () { return shadingMode; },
			set: function ( x ) { _stateSetter( setShadingMode, 'shadingMode', x ); }
		},

		'route': {
			writeable: true,
			get: function () { return survey.getRoutes().setRoute; },
			set: function ( x ) { survey.getRoutes().setRoute = x; }
		},

		'routeNames': {
			get: function () { return survey.getRoutes().getRouteNames(); },
		},

		'surfaceShading': {
			writeable: true,
			get: function () { return surfaceShadingMode; },
			set: function ( x ) { _stateSetter( setSurfaceShadingMode, 'surfaceShading', x ); }
		},

		'cameraType': {
			writeable: true,
			get: function () { return cameraMode; },
			set: function ( x ) { _stateSetter( setCameraMode, 'cameraType', x ); }
		},

		'eyeSeparation': {
			writeable: true,
			get: function () { return eyeSeparation; },
			set: setEyeSeparation
		},

		'view': {
			writeable: true,
			get: function () { return VIEW_NONE; },
			set: function ( x ) { _stateSetter( setViewMode, 'view', x ); }
		},

		'cursorHeight': {
			writeable: true,
			get: function () { return cursorHeight; },
			set: setCursorHeight
		},

		'initCursorHeight': {
			writeable: true,
			get: function () { return cursorHeight; },
			set: function ( x ) { cursorHeight = x; }
		},

		'maxDistance': {
			get: function () { return survey.getMaxDistance(); }
		},

		'maxHeight': {
			get: function () { return ( limits === null ) ? 0 : limits.max.z; }
		},

		'minHeight': {
			get: function () { return ( limits === null ) ? 0 : limits.min.z; }
		},

		'maxLegLength': {
			get: function () { return stats.maxLegLength; }
		},

		'minLegLength': {
			get: function () { return stats.minLegLength; }
		},

		'section': {
			writeable: true,
			get: function () { return selectedSection; },
			set: function ( x ) { _stateSetter( selectSection, 'section', x ); }
		},

		'sectionByName': {
			writeable: true,
			get: getSelectedSectionName,
			set: setSelectedSectionName
		},

		'highlight': {
			writeable: true,
			set: function ( x ) { _stateSetter( highlightSelection, 'highlight', x ); }
		},

		'polarAngle': {
			writeable: true,
			get: function () { return controls.getPolarAngle(); },
			set: function ( x ) { cameraMove.setPolarAngle( x ); }
		},

		'azimuthAngle': {
			writeable: true,
			set: function ( x ) { cameraMove.setAzimuthAngle( x ); }
		},

		'editMode': {
			writeable: true,
			get: function () { return mouseMode; },
			set: function ( x ) { _setEditMode( x ); this.dispatchEvent( { type: 'change', name: 'editMode' } ); }
		},

		'setPOI': {
			writeable: true,
			//get: function () { return true; },
			set: function ( x ) { _stateSetter( setCameraPOI, 'setPOI', x ); }
		},

		'HUD': {
			writeable: true,
			get: HUD.getVisibility,
			set: HUD.setVisibility
		},

		'cut': {
			writeable: true,
			// get: function () { return true; },
			set: cutSection
		},

		'zScale': {
			writeable: true,
			get: function () { return zScale; },
			set: setZScale
		},

		'autoRotate': {
			writeable: true,
			get: function () { return controls.autoRotate; },
			set: function ( x ) { setAutoRotate( !! x ); }
		},

		'autoRotateSpeed': {
			writeable: true,
			get: function () { return controls.autoRotateSpeed / 11; },
			set: setAutoRotateSpeed
		},

		'fullscreen': {
			writeable: true,
			get: isFullscreen,
			set: setFullscreen
		},

		'hasContours': {
			get: function () { return ! ( renderer.extensions.get( 'OES_standard_derivatives' ) === null ); }
		},

		'fog': {
			writeable: true,
			get: function () { return useFog; },
			set: setFog
		},

		'isClipped': {
			get: function () { return clipped; }
		}

	} );

	_enableLayer( FEATURE_BOX, 'box' );

	_conditionalLayer( FEATURE_ENTRANCES, 'entrances' );
	_conditionalLayer( FEATURE_STATIONS,  'stations' );
	_conditionalLayer( FEATURE_TRACES,    'traces' );
	_conditionalLayer( FACE_SCRAPS,       'scraps' );
	_conditionalLayer( FACE_WALLS,        'walls' );
	_conditionalLayer( LEG_CAVE,          'legs' );
	_conditionalLayer( LEG_SPLAY,         'splays' );
	_conditionalLayer( LEG_SURFACE,       'surfaceLegs' );
	_conditionalLayer( LABEL_STATION,     'stationLabels' );
	_conditionalLayer( LABEL_STATION_COMMENT, 'stationComments' );
	_conditionalLayer( FEATURE_ANNOTATIONS, 'annotations' );
	_conditionalLayer( SURVEY_WARNINGS,     'warnings' );

	Materials.initCache( Viewer );

	HUD.init( Viewer, renderer );

	caveLoader = new CaveLoader( caveLoaded );

	HUD.getProgressDial( 0 ).watch( caveLoader );

	// check if we are defaulting to full screen
	if ( isFullscreen() ) setBrowserFullscreen( true );

	viewState = new ViewState( Viewer );

	return;

	function _enableLayer ( layerTag, name ) {

		Object.defineProperty( Viewer, name, {
			writeable: true,
			get: function () { return cameraManager.testCameraLayer( layerTag ); },
			set: function ( x ) { setCameraLayer( layerTag, x ); this.dispatchEvent( { type: 'change', name: name } ); }
		} );

	}

	function _conditionalLayer ( layerTag, name ) {

		_enableLayer ( layerTag, name );

		name = 'has' + name.substr( 0, 1 ).toUpperCase() + name.substr( 1 );

		Object.defineProperty( Viewer, name, {
			get: function () { return survey.hasFeature( layerTag ); }
		} );

	}

	function _stateSetter ( modeFunction, name, newMode ) {

		modeFunction( isNaN( newMode ) ? newMode : Number( newMode ) );

		Viewer.dispatchEvent( { type: 'change', name: name } );

	}

	function _setEditMode ( x ) {

		mouseMode = Number( x );
		lastMouseMode = mouseMode;

		clickCount = 0;
		survey.markers.clear();
		survey.clearSelection();

		renderView();

		raycaster.params.Points.threshold = 3;

		switch ( mouseMode ) {

		case MOUSE_MODE_TRACE_EDIT:

			mouseTargets = survey.pointTargets.concat( [ survey.dyeTraces ] );

			break;

		case MOUSE_MODE_NORMAL:

			mouseTargets = survey.pointTargets;

			break;

		case MOUSE_MODE_ROUTE_EDIT:

			mouseTargets = survey.legTargets;

			break;

		case MOUSE_MODE_ENTRANCES:

			mouseTargets = survey.entranceTargets;
			raycaster.params.Points.threshold = 15;

			break;

		case MOUSE_MODE_ANNOTATE:

			mouseTargets = survey.pointTargets;

			break;

		default:

			console.warn( 'invalid mouse mode', x );

		}

	}

}

function isFullscreen () {

	return (
		window.innerHeight === container.clientHeight &&
		window.innerWidth === container.clientWidth
	);

}

function setFullscreen ( targetState ) {

	if ( isFullscreen() !== targetState ) {

		container.classList.toggle( 'toggle-fullscreen' );

		setBrowserFullscreen( targetState );

		resize();

		Viewer.dispatchEvent( { type: 'change', name: 'fullscreen' } );

	}

}

function setBrowserFullscreen ( targetState ) {

	if ( targetState ) {

		if ( container.webkitRequestFullscreen ) {
			container.webkitRequestFullscreen();
		} else if ( container.mozRequestFullScreen ) {
			container.mozRequestFullScreen();
		} else if ( container.msRequestFullscreen ) {
			container.msRequestFullscreen();
		}

	} else {

		if ( document.webkitExitFullscreen ) {
			document.webkitExitFullscreen();
		} else if ( document.mozCancelFullScreen ) {
			document.mozCancelFullScreen();
		} else if ( document.msExitFullscreen ) {
			document.msExitFullscreen();
		}

	}

}

function setZScale ( scale ) {

	// scale - in range 0 - 1

	const lastScale = Math.pow( 2, ( zScale - 0.5 ) * 4 );
	const newScale  = Math.pow( 2, ( scale - 0.5 ) * 4 );

	survey.applyMatrix( new Matrix4().makeScale( 1, 1, newScale / lastScale ) );
	survey.updateMatrix();

	zScale = scale;

	renderView();

}

function setAutoRotate ( state ) {

	cameraMove.setAutoRotate( state );

	Viewer.dispatchEvent( { type: 'change', name: 'autoRotate' } );

}

function setAutoRotateSpeed ( speed ) {

	controls.autoRotateSpeed = Math.max( Math.min( speed, 1.0 ), -1.0 ) * 11;

	Viewer.dispatchEvent( { type: 'change', name: 'autoRotateSpeed' } );

}

function setCursorHeight ( x ) {

	cursorHeight = x;
	Viewer.dispatchEvent( { type: 'cursorChange', name: 'cursorHeight' } );

	renderView();

}

function setTerrainShadingMode ( mode ) {

	if ( survey.terrain === null ) return;

	if ( terrain.setShadingMode( mode, renderView ) ) terrainShadingMode = mode;

	renderView();
	updateTerrain();

}

function setTerrainOpacity ( x ) {

	if ( terrain === null ) return;

	terrain.setOpacity( x );
	Viewer.dispatchEvent( { type: 'change', name: 'terrainOpacity' } );

	renderView();

}

function setTerrainLighting( on ) {

	lightingManager.directionalLighting = on;

	renderView();

}

function applyTerrainDatumShift( x ) {

	if ( terrain === null ) return;

	terrain.applyDatumShift( x );
	Viewer.dispatchEvent( { type: 'change', name: 'terrainDatumShift' } );

	renderView();

}

function renderDepthTexture () {

	if ( ! terrain.isLoaded ) return;

	const dim = 1024;

	// set camera frustrum to cover region/survey area

	var width  = container.clientWidth;
	var height = container.clientHeight;

	const range = survey.combinedLimits.getSize( __v );

	const scaleX = width / range.x;
	const scaleY = height / range.y;

	if ( scaleX < scaleY ) {

		height = height * scaleX / scaleY;

	} else {

		width = width * scaleY / scaleX;

	}

	// render the terrain to a new canvas square canvas and extract image data

	const rtCamera = new OrthographicCamera( -width / 2, width / 2, height / 2, -height / 2, -10000, 10000 );

	rtCamera.layers.set( FEATURE_TERRAIN ); // just render the terrain

	scene.overrideMaterial = Materials.getDepthMapMaterial( terrain );

	const renderTarget = new WebGLRenderTarget( dim, dim, { minFilter: LinearFilter, magFilter: NearestFilter, format: RGBAFormat, stencilBuffer: true } );

	renderTarget.texture.generateMipmaps = false;
	renderTarget.texture.name = 'CV.DepthMapTexture';

	renderer.setSize( dim, dim );
	renderer.setPixelRatio( 1 );

	renderer.clear();

	renderer.setRenderTarget( renderTarget );

	renderer.render( scene, rtCamera );

	// correct height between entrances and terrain

	terrain.addHeightMap( renderer, renderTarget );

	survey.calibrateTerrain( terrain );

	Materials.setTerrain( terrain );

	// restore renderer to normal render size and target

	renderer.setRenderTarget( defaultRenderTarget ); // revert to screen canvas

	renderer.setSize( container.clientWidth, container.clientHeight );
	renderer.setPixelRatio( window.devicePixelRatio );

	scene.overrideMaterial = null;

	orientationControls.survey = survey;

	renderView();

	// clear renderList to release objects on heap associated with rtCamera
	renderer.renderLists.dispose();

}

function setCameraMode ( mode ) {

	if ( mode === cameraMode || ! renderRequired ) return;

	if ( mode === CAMERA_DYNAMIC ) {

		savedView = viewState.saveState();
		orientationControls.connect();

		setView( dynamicView, null );

	} else {

		if ( cameraMode === CAMERA_DYNAMIC ) {

			// disable orientation controls
			orientationControls.disconnect();

			// restore previous settings
			setView( savedView, null );

		}

		cameraManager.setCamera( mode, controls.target );
		activeRenderer = cameraManager.activeRenderer;

	}

	cameraMode = mode;

	renderView();

}

function cameraMoved () {

	__rotation.setFromQuaternion( cameraManager.activeCamera.getWorldQuaternion( __q ) );

	lightingManager.setRotation( __rotation );

	renderView();

}

function setCameraLayer ( layerTag, enable ) {

	cameraManager.setCameraLayer( layerTag, enable );
	renderView();

}

function setEyeSeparation ( x ) {

	cameraManager.setEyeSeparation( x );
	renderView();

}

function setViewMode ( mode ) {

	const boundingBox = survey.getWorldBoundingBox();
	const targetAxis = __v;

	switch ( mode ) {

	case VIEW_NONE:

		return;

	case VIEW_PLAN:

		targetAxis.set( 0, 0, -1 );

		break;

	case VIEW_ELEVATION_N:

		targetAxis.set( 0, 1, 0 );

		break;

	case VIEW_ELEVATION_S:

		targetAxis.set( 0, -1, 0 );

		break;

	case VIEW_ELEVATION_E:

		targetAxis.set( 1, 0, 0 );

		break;

	case VIEW_ELEVATION_W:

		targetAxis.set( -1, 0, 0 );

		break;

	default:

		console.warn( 'invalid view mode specified: ', mode );
		return;

	}

	cameraMove.prepare( boundingBox, targetAxis );
	cameraMove.start( renderRequired );

}

function setFog( enable ) {

	useFog = enable;

	fog.density = useFog ? 0.0025 : 0;

	renderView();

}

function setShadingMode ( mode ) {

	if ( survey.setShadingMode( mode ) ) shadingMode = mode;

	if ( shadingMode === SHADING_DISTANCE ) {

		lastMouseMode = mouseMode;
		mouseMode = MOUSE_MODE_DISTANCE;
		mouseTargets = survey.pointTargets;

	} else {

		mouseMode = lastMouseMode;

	}

	renderView();

}

function setSurfaceShadingMode ( mode ) {

	if ( survey.setLegShading( LEG_SURFACE, mode ) ) surfaceShadingMode = mode;

	renderView();

}

function addOverlay ( name, overlayProvider ) {

	CommonTerrain.addOverlay( name, overlayProvider, container );

}

function addFormatters( stationFormatter ) {

	formatters.station = stationFormatter;

}


function cutSection () {

	if ( selectedSection === survey.surveyTree || selectedSection.p !== undefined ) return;

	cameraMove.cancel();

	survey.remove( terrain );
	survey.cutSection( selectedSection );

	// grab a reference to prevent survey being destroyed in clearView()
	const cutSurvey = survey;

	// reset view
	clearView();

	clipped = true;

	loadSurvey( cutSurvey );

}

function highlightSelection ( node ) {

	survey.highlightSelection( node );

	renderView();

}

function selectSection ( node ) {

	if ( node.p === undefined ) {

		_selectSection( node );

	} else {

		_selectStation( node );

	}

	selectedSection = node;

	renderView();

	return;

	function _selectSection ( node ) {

		survey.selectSection( node );

		setShadingMode( shadingMode );

		if ( node === survey.surveyTree ) {

			cameraMove.prepare( survey.getWorldBoundingBox() );
			cameraMove.start( renderRequired );

			highlightSelection( node );

			return;

		} else {

			if ( node.boundingBox === undefined ) return;

			const boundingBox = node.boundingBox.clone();

			cameraMove.prepare( boundingBox.applyMatrix4( survey.matrixWorld ) );

		}

	}

	function _selectStation( node ) {

		if ( mouseMode === MOUSE_MODE_TRACE_EDIT ) {

			selectTraceStation( node );

		} else {

			survey.selectSection( node );

			setShadingMode( shadingMode );

			cameraMove.preparePoint( survey.getWorldPosition( node.p.clone() ) );

		}

	}

}


function getSelectedSectionName () {

	if ( selectedSection === survey.surveyTree ) {

		return '';

	} else {

		return selectedSection === undefined ? '' : selectedSection.getPath();

	}

}

function setSelectedSectionName ( name ) {

	const node = survey.surveyTree.getByPath( name );

	selectSection( node === undefined ? survey.surveyTree : node );

}

function resize () {

	const width  = container.clientWidth;
	const height = container.clientHeight;

	// adjust the renderer to the new canvas size
	renderer.setSize( width, height );

	cameraManager.resize( width, height );

	Viewer.dispatchEvent( { type: 'resized', name: '-' } );

	renderView();

}

function clearView () {

	// clear the current cave model, and clear the screen
	caveIsLoaded = false;

	renderer.clear();

	HUD.setVisibility( false );

	// terminate all running workers (tile loading/wall building etc)

	WorkerPool.terminateActive();

	scene.remove( survey );

	controls.enabled = false;

	survey          = null;
	terrain         = null;
	limits          = null;
	selectedSection = null;
	mouseMode       = MOUSE_MODE_NORMAL;
	mouseTargets    = [];

	// remove event listeners

	container.removeEventListener( 'mousedown', mouseDown );

	cameraManager.resetCameras();

	controls.reset();

}

function loadCave ( file, section ) {

	caveLoader.reset();
	caveLoader.loadFile( file, section );

	clipped = ( section !== undefined && section != '' );

}

function loadCaves ( files ) {

	caveLoader.reset();
	caveLoader.loadFiles( files );

}

function caveLoaded ( cave ) {

	if ( ! cave ) {

		alert( 'failed loading cave information' );
		return;

	}

	loadSurvey( new Survey( cave ) );

}

function setView ( properties1, properties2 ) {

	// don't render until all settings made.

	renderRequired = false;

	Object.assign( Viewer, properties1, properties2 );

	renderRequired = true;

	renderView();

}

function setupView ( final ) {

	setView( defaultView, Cfg.value( 'view', {} ) );

	if ( final ) {

		// signal any listeners that we have a new cave

		Viewer.dispatchEvent( { type: 'newCave', name: 'newCave' } );

	}

}

function loadSurvey ( newSurvey ) {

	var syncTerrainLoading = true;

	// only render after first SetupView()
	renderRequired = false;

	survey = newSurvey;

	HUD.getProgressDial( 1 ).watch( survey );

	stats = getLegStats( LEG_CAVE );

	setScale();

	Materials.flushCache( survey );

	terrain = survey.terrain;

	scene.addStatic( survey );

	mouseTargets = survey.pointTargets;

	// set if we have independant terrain maps

	if ( terrain === null ) {

		if ( navigator.onLine ) {

			terrain = new WebTerrain( survey, _tilesLoaded, container );

			HUD.getProgressDial( 0 ).watch( terrain );

			syncTerrainLoading = ! terrain.load();

			if ( syncTerrainLoading ) terrain = null;

		}

	} else {

		terrain.checkTerrainShadingModes( renderer );

		survey.addStatic( terrain );

		renderDepthTexture();

	}

	scene.matrixAutoUpdate = false;

	container.addEventListener( 'mousedown', mouseDown, false );

	controls.enabled = true;

	survey.getRoutes().addEventListener( 'changed', surveyChanged );
	survey.addEventListener( 'changed', surveyChanged );

	caveIsLoaded = true;

	selectedSection = survey.surveyTree;

	setupView( syncTerrainLoading );

	function _tilesLoaded ( errors ) {

		if ( terrain.parent === null ) {

			if ( errors > 0 ) {

				console.log( 'errors loading terrain' );

				terrain = null;

				setupView( true );

				return;

			}

			survey.terrain = terrain;

			terrain.checkTerrainShadingModes( renderer );

			survey.addStatic( terrain );

			renderDepthTexture();

			setupView( true );

		}

		renderView();

	}

}

function surveyChanged ( /* event */ ) {

	setShadingMode( shadingMode );

}

function loadTerrain ( mode ) {

	if ( terrain !== null && terrain.isLoaded ) {

		terrain.setVisibility( mode );

		setCameraLayer( FEATURE_TERRAIN, mode );

		Viewer.dispatchEvent( { type: 'change', name: 'terrain' } );

	}

}

function mouseDown ( event ) {

	const bc = container.getBoundingClientRect();

	// FIXME - handle scrolled container
	mouse.x =   ( ( event.clientX - bc.left ) / container.clientWidth ) * 2 - 1;
	mouse.y = - ( ( event.clientY - bc.top ) / container.clientHeight ) * 2 + 1;

	raycaster.setFromCamera( mouse, cameraManager.activeCamera );

	const intersects = raycaster.intersectObjects( mouseTargets, false );

	if ( intersects.length < 1 ) return;

	switch ( mouseMode ) {

	case MOUSE_MODE_NORMAL:

		_selectStation( visibleStation( intersects ) );

		break;

	case MOUSE_MODE_ROUTE_EDIT:

		_selectSegment( intersects[ 0 ] );

		break;

	case MOUSE_MODE_DISTANCE:

		_selectDistance( visibleStation( intersects ) );

		break;

	case MOUSE_MODE_TRACE_EDIT:

		if ( event.button === MOUSE.LEFT ) {

			if ( intersects[ 0 ].object.type === 'Mesh' ) {

				selectTrace( intersects[ 0 ] );

			} else {

				selectTraceStation( visibleStation( intersects ) );

			}

		}

		break;
	/*
	case MOUSE_MODE_ENTRANCES:

		selectEntrance( intersects[ 0 ] );

		break;

	case MOUSE_MODE_ANNOTATE:

		selectAnnotation( visibleStation( intersects ) );
	*/
	}

	function _selectStation ( station ) {

		if ( station === null ) return;

		survey.selectStation( station );

		if ( event.button === MOUSE.LEFT ) {

			_showStationPopup( station );

		} else if ( event.button === MOUSE.RIGHT ) {

			_setStationPOI( station );

		}

	}

	function _setStationPOI( station ) {

		selectSection( station );

		cameraMove.start( true );
		event.stopPropagation();

		container.addEventListener( 'mouseup', _mouseUpLeft );

	}

	function _selectDistance ( station ) {

		if ( station === null ) return;

		if ( event.button === MOUSE.LEFT ) {

			survey.showShortestPath( station );

			_showStationPopup( station );

		} else if ( event.button === MOUSE.RIGHT ) {

			survey.shortestPathSearch( station );

			Viewer.dispatchEvent( { type: 'change', name: 'shadingMode' } );
			renderView();

		}

	}

	function _mouseUpLeft () {

		controls.enabled = true;
		container.removeEventListener( 'mouseup', _mouseUpLeft );

	}

	function _showStationPopup ( station ) {

		const depth = ( terrain ) ? station.p.z - terrain.getHeight( station.p ) : null;

		if ( popup !== null ) return;

		popup = new StationPopup( container, station, survey, depth, formatters.station, ( shadingMode === SHADING_DISTANCE ), Viewer.warnings );

		survey.add( popup );

		container.addEventListener( 'mouseup', _mouseUpRight );

		renderView();

		cameraMove.preparePoint( survey.getWorldPosition( station.p.clone() ) );

		return true;

	}

	function _selectSegment ( picked ) {

		const routes = survey.getRoutes();

		routes.toggleSegment( picked.index );

		setShadingMode( SHADING_PATH );

		renderView();

		return true;

	}

	function _mouseUpRight ( /* event */ ) {

		container.removeEventListener( 'mouseup', _mouseUpRight );

		popup.close();
		popup = null;

		survey.clearSelection();

		renderView();

	}

}
/*
function selectAnnotation ( station ) {

	const annotations = survey.annotations;

	if ( station === null ) return;

	survey.selectStation( station );

	Viewer.dispatchEvent( {
		type: 'selectedAnnotation',
		annotationInfo: annotations.getStation( station ),
		add: function _setAnnotation( annotation ) {

			console.log( 'annotation handler: ', annotation );
			annotations.setStation( station, annotation );
			renderView();

		}
	} );

	renderView();

}

function selectEntrance ( hit ) {

	const entrances = survey.entrances;
	const info = entrances.getStation( hit.index );

	Viewer.dispatchEvent( {
		type: 'selectedEntrance',
		entrance: info
	} );

}
*/
function selectTrace ( hit ) {

	const dyeTraces = survey.dyeTraces;
	const traceIndex = hit.faceIndex;

	survey.markers.clear();

	dyeTraces.outlineTrace( traceIndex );

	Viewer.dispatchEvent( {
		type: 'selectedTrace',
		trace: dyeTraces.getTraceStations( traceIndex ),
		delete: function _deleteTrace () {
			dyeTraces.deleteTrace( traceIndex );
			renderView();
		}
	} );

	renderView();

}

function selectTraceStation ( station ) {

	if ( station === null ) return;

	const dyeTraces = survey.dyeTraces;
	const markers = survey.markers;

	dyeTraces.outlineTrace( null );

	if ( ++clickCount === 3 ) {

		markers.clear();
		clickCount = 1;

	}

	markers.mark( station );

	const list = markers.getStations();

	var start, end;

	if ( list[ 0 ] !== undefined ) start = list[ 0 ].getPath();
	if ( list[ 1 ] !== undefined ) end = list[ 1 ].getPath();

	Viewer.dispatchEvent( {
		type: 'selectedTrace',
		start: start,
		end: end,
		add: function () {
			if ( list.length !== 2 ) return;

			dyeTraces.addTrace( list[ 0 ], list[ 1 ] );

			markers.clear();
			renderView();

		}
	} );

	renderView();

}

function visibleStation ( intersects ) {

	const camera = cameraManager.activeCamera;

	var minD2 = Infinity;
	var closestStation = null;

	intersects.forEach( function _checkIntersects( intersect ) {

		const station = survey.stations.getStationByIndex( intersect.index );

		// don't select spays unless visible

		if ( ! Viewer.splays && station !== null && station.p.connections === 0 ) return;

		// station in screen NDC
		__v.copy( station.p ).applyMatrix4( survey.matrixWorld ).project( camera );

		__v.sub( intersect.point.project( camera ) );

		const d2 = __v.x * __v.x + __v.y * __v.y;

		// choose closest of potential matches in screen x/y space

		if ( d2 < minD2 ) {

			minD2 = d2;
			closestStation = station;

		}

	} );

	return closestStation;

}

function renderView () {

	if ( ! renderRequired ) return;

	renderer.clear();

	if ( caveIsLoaded ) {

		const camera = cameraManager.activeCamera;

		survey.update( camera, controls.target );

		if ( useFog ) Materials.setFog( true );

		activeRenderer( scene, camera );

	}

	if ( useFog ) Materials.setFog( false );

	HUD.renderHUD();

}

function onCameraMoveEnd () {

	Viewer.dispatchEvent( { type: 'moved' } );

	if ( terrain && terrain.isTiled && Viewer.terrain ) {

		// schedule a timeout to load replace discarded tiles or higher res tiles

		if ( timerId !== null ) {

			clearTimeout( timerId );

		}

		lastActivityTime = performance.now();
		timerId = setTimeout( updateTerrain, RETILE_TIMEOUT );

	}

}

function updateTerrain () {

	if ( performance.now() - lastActivityTime > RETILE_TIMEOUT ) {

		if ( Viewer.terrain && terrain.zoomCheck( cameraManager.activeCamera ) ) {

			setTimeout( updateTerrain, RETILE_TIMEOUT * 5 );

		}

	}

	timerId = null;

}

function setCameraPOI () {

	cameraMove.start( true );

}

function setScale () {

	const width  = container.clientWidth;
	const height = container.clientHeight;

	// scaling to compensate distortion introduced by projection ( x and y coords only ) - approx only
	const scaleFactor = survey.scaleFactor;

	limits = survey.limits;

	const range = survey.combinedLimits.getSize( __v );

	// initialize cursor height to be mid range of heights
	cursorHeight = 0;

	// initialize vertical scaling to none
	zScale = 0.5;

	var hScale = Math.min( width / range.x, height / range.y );

	if ( hScale === Infinity ) hScale = 1;

	const vScale = hScale * scaleFactor;

	survey.setScale( hScale, vScale );

	HUD.setScale( vScale );

}

function getLegStats ( type ) {

	const legs = survey.getFeature( type );

	return ( legs !== undefined ) ? survey.getFeature( type ).stats : {
		legs: 0,
		legLength: 0,
		minLegLength: 0,
		maxLegLength: 0
	};

}

function getControls () {

	return controls;

}

function getMetadata () {

	return survey.metadata;

}

function getSurveyTree () {

	return survey.surveyTree;

}

// export public interface

Object.assign( Viewer, {
	init:          init,
	clearView:     clearView,
	loadCave:      loadCave,
	loadCaves:     loadCaves,
	getMetadata:   getMetadata,
	getLegStats:   getLegStats,
	getSurveyTree: getSurveyTree,
	getControls:   getControls,
	renderView:    renderView,
	addOverlay:    addOverlay,
	addFormatters: addFormatters,
	// addAnnotator:  Annotations.addAnnotator,
	setView:       setView
} );

export { Viewer };


// EOF