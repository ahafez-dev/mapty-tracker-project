'use strict';

/** @typedef {[number, number]} LatLng */

/**
 * Base Workout class. Represents a single workout with location, distance, and duration.
 * @class
 */
class Workout {
  #coords;
  #distance;
  #duration;
  #date;
  #id;
  #description;
  #clicks = 0;

  /**
   * Create a Workout.
   * @param {LatLng} coords - [latitude, longitude]
   * @param {number} distance - Distance in km
   * @param {number} duration - Duration in minutes
   */
  constructor(coords, distance, duration) {
    this.#coords = coords;
    this.#distance = distance;
    this.#duration = duration;
    this.#date = new Date();
    this.#id = String(Date.now()).slice(-10);
    this.#description = '';
  }

  /** @type {LatLng} */
  get coords() {
    return this.#coords;
  }

  /** @type {number} */
  get distance() {
    return this.#distance;
  }

  /** @type {number} */
  get duration() {
    return this.#duration;
  }

  /** @type {Date} */
  get date() {
    return this.#date;
  }

  /** @type {string} */
  get id() {
    return this.#id;
  }

  /** @type {string} */
  get description() {
    return this.#description;
  }

  /** @param {string} value */
  set description(value) {
    this.#description = value;
  }

  /**
   * Builds the workout description string (e.g. "Running on March 10").
   * @private
   */
  _setDescription() {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const type = this.type?.[0]?.toUpperCase() + (this.type?.slice(1) ?? '');
    this.#description = `${type} on ${months[this.#date.getMonth()]} ${this.#date.getDate()}`;
  }

  /** Increment click count (for future analytics). */
  click() {
    this.#clicks++;
  }
}

/**
 * Running workout with cadence and pace.
 * @extends Workout
 */
class Running extends Workout {
  type = 'running';

  /**
   * @param {LatLng} coords
   * @param {number} distance - km
   * @param {number} duration - min
   * @param {number} cadence - steps per minute
   */
  constructor(coords, distance, duration, cadence) {
    super(coords, distance, duration);
    this.cadence = cadence;
    this.calcPace();
    this._setDescription();
  }

  /** @returns {number} Pace in min/km */
  calcPace() {
    this.pace = this.duration / this.distance;
    return this.pace;
  }
}

/**
 * Cycling workout with elevation gain and speed.
 * @extends Workout
 */
class Cycling extends Workout {
  type = 'cycling';

  /**
   * @param {LatLng} coords
   * @param {number} distance - km
   * @param {number} duration - min
   * @param {number} elevationGain - meters
   */
  constructor(coords, distance, duration, elevationGain) {
    super(coords, distance, duration);
    this.elevationGain = elevationGain;
    this.calcSpeed();
    this._setDescription();
  }

  /** @returns {number} Speed in km/h */
  calcSpeed() {
    this.speed = this.distance / (this.duration / 60);
    return this.speed;
  }
}

/** CartoDB Voyager tile URL — light, modern style (free, no key required). */
const TILE_LAYER_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

///////////////////////////////////////
// APPLICATION
///////////////////////////////////////

const form = document.querySelector('.form');
const containerWorkouts = document.querySelector('.workouts');
const inputType = document.querySelector('.form__input--type');
const inputDistance = document.querySelector('.form__input--distance');
const inputDuration = document.querySelector('.form__input--duration');
const inputCadence = document.querySelector('.form__input--cadence');
const inputElevation = document.querySelector('.form__input--elevation');
const formErrorEl = document.getElementById('formError');
const mapLoadingEl = document.getElementById('mapLoading');
const btnClearAll = document.getElementById('btnClearAll');

/**
 * Main application controller. Handles map, workouts list, form, and persistence.
 * @class
 */
class App {
  #map = null;
  #mapZoomLevel = 13;
  #mapEvent = null;
  #workouts = [];

  constructor() {
    this._getPosition();
    this._getLocalStorage();
    this._bindEvents();
    this._updateClearButtonState();
  }

  /** Attach DOM event listeners. */
  _bindEvents() {
    form?.addEventListener('submit', this._newWorkout.bind(this));
    inputType?.addEventListener('change', this._toggleElevationField.bind(this));
    containerWorkouts?.addEventListener('click', this._moveToPopup.bind(this));
    btnClearAll?.addEventListener('click', this._clearAllWorkouts.bind(this));
  }

  /**
   * Get user position and load map, or show error.
   * @private
   */
  _getPosition() {
    if (!navigator.geolocation) {
      this._hideMapLoading('Could not get your position');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      this._loadMap.bind(this),
      () => this._hideMapLoading('Could not get your position'),
      { enableHighAccuracy: true }
    );
  }

  /**
   * Hide the map loading overlay (with optional message).
   * @param {string} [message]
   * @private
   */
  _hideMapLoading(message) {
    if (message) alert(message);
    mapLoadingEl?.classList.add('hidden');
  }

  /**
   * Initialize Leaflet map and tile layer (CartoDB Dark Matter).
   * @param {GeolocationPosition} position
   * @private
   */
  _loadMap(position) {
    const { latitude, longitude } = position?.coords ?? {};
    const coords = [latitude, longitude];

    this.#map = L.map('map').setView(coords, this.#mapZoomLevel);

    L.tileLayer(TILE_LAYER_URL, {
      attribution: TILE_ATTRIBUTION,
    }).addTo(this.#map);

    this.#map.on('click', this._showForm.bind(this));

    this.#workouts.forEach((work) => this._renderWorkoutMarker(work));
    this._hideMapLoading();
  }

  /**
   * Show form at click position and store map event.
   * @param {L.LeafletMouseEvent} mapE
   * @private
   */
  _showForm(mapE) {
    this.#mapEvent = mapE;
    this._clearValidationState();
    form?.classList.remove('hidden');
    inputDistance?.focus();
  }

  /** Clear error styling and message from form. */
  _clearValidationState() {
    formErrorEl?.classList.remove('visible');
    formErrorEl && (formErrorEl.textContent = '');
    [inputDistance, inputDuration, inputCadence, inputElevation].forEach((input) => {
      input?.classList.remove('form__input--error');
    });
  }

  /**
   * Show validation error message and mark invalid inputs.
   * @param {string} message
   * @param {HTMLInputElement[]} [invalidInputs]
   * @private
   */
  _showValidationError(message, invalidInputs = []) {
    if (formErrorEl) {
      formErrorEl.textContent = message;
      formErrorEl.classList.add('visible');
    }
    invalidInputs.forEach((el) => el?.classList.add('form__input--error'));
  }

  _hideForm() {
    inputDistance && (inputDistance.value = '');
    inputDuration && (inputDuration.value = '');
    inputCadence && (inputCadence.value = '');
    inputElevation && (inputElevation.value = '');
    this._clearValidationState();
    form && (form.style.display = 'none');
    form?.classList.add('hidden');
    setTimeout(() => {
      if (form) form.style.display = 'grid';
    }, 400);
  }

  _toggleElevationField() {
    const elevRow = inputElevation?.closest('.form__row');
    const cadRow = inputCadence?.closest('.form__row');
    elevRow?.classList.toggle('form__row--hidden');
    cadRow?.classList.toggle('form__row--hidden');
  }

  /**
   * Validate that all values are finite and positive.
   * @param {Array<{ value: number; el: HTMLInputElement }>} fields
   * @returns {{ valid: boolean; invalidInputs: HTMLInputElement[]; message?: string }}
   */
  _validatePositiveNumbers(fields) {
    const invalidInputs = [];
    for (const { value, el } of fields) {
      if (!Number.isFinite(value) || value <= 0) invalidInputs.push(el);
    }
    if (invalidInputs.length) {
      const msg = 'All values must be positive numbers.';
      return { valid: false, invalidInputs, message: msg };
    }
    return { valid: true, invalidInputs: [] };
  }

  /**
   * Handle form submit: validate, create workout, render, persist.
   * @param {Event} e
   * @private
   */
  _newWorkout(e) {
    e.preventDefault();
    const type = inputType?.value ?? 'running';
    const distance = Number(inputDistance?.value);
    const duration = Number(inputDuration?.value);
    const { lat, lng } = this.#mapEvent?.latlng ?? {};

    const distanceEl = inputDistance;
    const durationEl = inputDuration;

    if (type === 'running') {
      const cadence = Number(inputCadence?.value);
      const result = this._validatePositiveNumbers([
        { value: distance, el: distanceEl },
        { value: duration, el: durationEl },
        { value: cadence, el: inputCadence },
      ]);
      if (!result.valid) {
        this._showValidationError(result.message ?? 'Invalid inputs', result.invalidInputs);
        return;
      }
      const workout = new Running([lat, lng], distance, duration, cadence);
      this.#workouts.push(workout);
      this._renderWorkoutMarker(workout);
      this._renderWorkout(workout);
    }

    if (type === 'cycling') {
      const elevation = Number(inputElevation?.value);
      const result = this._validatePositiveNumbers([
        { value: distance, el: distanceEl },
        { value: duration, el: durationEl },
        { value: elevation, el: inputElevation },
      ]);
      if (!result.valid) {
        this._showValidationError(result.message ?? 'Invalid inputs', result.invalidInputs);
        return;
      }
      const workout = new Cycling([lat, lng], distance, duration, elevation);
      this.#workouts.push(workout);
      this._renderWorkoutMarker(workout);
      this._renderWorkout(workout);
    }

    this._hideForm();
    this._setLocalStorage();
    this._updateClearButtonState();
  }

  /**
   * Render a workout marker and popup on the map.
   * @param {Workout} workout
   * @private
   */
  _renderWorkoutMarker(workout) {
    if (!this.#map || !workout?.coords) return;
    const icon = workout.type === 'running' ? '🏃‍♂️' : '🚴‍♀️';
    L.marker(workout.coords)
      .addTo(this.#map)
      .bindPopup(
        L.popup({
          maxWidth: 250,
          minWidth: 100,
          autoClose: false,
          closeOnClick: false,
          className: `${workout.type}-popup`,
        })
      )
      .setPopupContent(`${icon} ${workout.description}`)
      .openPopup();
  }

  /**
   * Render a workout pill card in the sidebar list.
   * @param {Workout} workout
   * @private
   */
  _renderWorkout(workout) {
    const icon = workout.type === 'running' ? '🏃‍♂️' : '🚴‍♀️';
    let html = `
      <li class="workout workout--${workout.type}" data-id="${workout.id}">
        <h2 class="workout__title">${workout.description}</h2>
        <div class="workout__details">
          <span class="workout__icon">${icon}</span>
          <span class="workout__value">${workout.distance}</span>
          <span class="workout__unit">km</span>
        </div>
        <div class="workout__details">
          <span class="workout__icon">⏱</span>
          <span class="workout__value">${workout.duration}</span>
          <span class="workout__unit">min</span>
        </div>
    `;
    if (workout.type === 'running') {
      html += `
        <div class="workout__details">
          <span class="workout__icon">⚡️</span>
          <span class="workout__value">${Number(workout.pace).toFixed(1)}</span>
          <span class="workout__unit">min/km</span>
        </div>
        <div class="workout__details">
          <span class="workout__icon">🦶🏼</span>
          <span class="workout__value">${workout.cadence}</span>
          <span class="workout__unit">spm</span>
        </div>
      </li>`;
    }
    if (workout.type === 'cycling') {
      html += `
        <div class="workout__details">
          <span class="workout__icon">⚡️</span>
          <span class="workout__value">${Number(workout.speed).toFixed(1)}</span>
          <span class="workout__unit">km/h</span>
        </div>
        <div class="workout__details">
          <span class="workout__icon">⛰</span>
          <span class="workout__value">${workout.elevationGain}</span>
          <span class="workout__unit">m</span>
        </div>
      </li>`;
    }
    form?.insertAdjacentHTML('afterend', html);
  }

  /**
   * Move map view to the workout associated with the clicked list item.
   * @param {MouseEvent} e
   * @private
   */
  _moveToPopup(e) {
    if (!this.#map) return;
    const workoutEl = e.target?.closest('.workout');
    if (!workoutEl) return;
    const id = workoutEl.dataset?.id;
    const workout = this.#workouts.find((w) => w.id === id);
    if (!workout?.coords) return;
    this.#map.setView(workout.coords, this.#mapZoomLevel, {
      animate: true,
      pan: { duration: 1 },
    });
  }

  _setLocalStorage() {
    try {
      localStorage.setItem('workouts', JSON.stringify(this.#workouts));
    } catch (err) {
      console.warn('Could not save workouts to localStorage', err);
    }
  }

  _getLocalStorage() {
    try {
      const data = JSON.parse(localStorage.getItem('workouts') ?? 'null');
      if (!data?.length) return;
      this.#workouts = data.map((item) => this._workoutFromStorage(item)).filter(Boolean);
      this.#workouts.forEach((work) => this._renderWorkout(work));
    } catch (err) {
      console.warn('Could not load workouts from localStorage', err);
    }
  }

  /**
   * Rehydrate a workout plain object from localStorage into a Running or Cycling instance.
   * @param {Object} item - Stored workout object
   * @returns {Workout|null}
   * @private
   */
  _workoutFromStorage(item) {
    const { coords, distance, duration, type } = item ?? {};
    if (!coords?.length || !Number.isFinite(distance) || !Number.isFinite(duration)) return null;
    if (type === 'running' && Number.isFinite(item.cadence)) {
      return new Running(coords, distance, duration, item.cadence);
    }
    if (type === 'cycling' && Number.isFinite(item.elevationGain)) {
      return new Cycling(coords, distance, duration, item.elevationGain);
    }
    return null;
  }

  /** Enable or disable Clear All button based on workout count. */
  _updateClearButtonState() {
    if (btnClearAll) btnClearAll.disabled = this.#workouts.length === 0;
  }

  /** Clear all workouts from memory, DOM, and localStorage; reload. */
  _clearAllWorkouts() {
    if (this.#workouts.length === 0) return;
    if (!confirm('Remove all workouts? This cannot be undone.')) return;
    localStorage.removeItem('workouts');
    location.reload();
  }
}

const app = new App();
