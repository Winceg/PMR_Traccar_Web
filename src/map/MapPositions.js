import { useId, useCallback, useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { map } from './core/MapView';
import { formatTime, formatNumber, getStatusColor } from '../common/util/formatter';
import { mapIconKey } from './core/preloadImages';
import { useAttributePreference } from '../common/util/preferences';
import { useCatchCallback } from '../reactHelper';
import { findFonts } from './core/mapUtil';

const MapPositions = ({
  positions,
  onMapClick,
  onMarkerClick,
  showStatus,
  selectedPosition,
  titleField,
  disabled,
}) => {
  const id = useId();
  const clusters = `${id}-clusters`;
  const selected = `${id}-selected`;

  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const iconScale = useAttributePreference('iconScale', desktop ? 0.75 : 1);

  const devices = useSelector((state) => state.devices.items);
  const selectedDeviceId = useSelector((state) => state.devices.selectedId);
  const serverAttributes = useSelector((state) => state.session.server.attributes);

  const mapCluster = useAttributePreference('mapCluster', true);
  const directionType = useAttributePreference('mapDirection', 'selected');

  const [blink, setBlink] = useState(false);

  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const createFeature = useCallback(
    (devices, position, selectedPositionId) => {
      const device = devices[position.deviceId];
      let showDirection;
      switch (directionType) {
        case 'none':
          showDirection = false;
          break;
        case 'all':
          showDirection = position.course > 0;
          break;
        default:
          showDirection = selectedPositionId === position.id && position.course > 0;
          break;
      }
      const sensorLines = Object.entries(position.attributes)
        .filter(([key]) => serverAttributes[`sensorUnit.${key}`] !== undefined)
        .map(([key, value]) => `${formatNumber(value)} ${serverAttributes[`sensorUnit.${key}`]}`);
      const sensorAlert = Object.entries(position.attributes).some(([key, value]) => {
        const min = device.attributes[`sensorMin.${key}`];
        const max = device.attributes[`sensorMax.${key}`];
        return (min !== undefined && value < Number(min)) || (max !== undefined && value > Number(max));
      });
      return {
        id: position.id,
        deviceId: position.deviceId,
        name: device.name,
        fixTime: formatTime(position.fixTime, 'seconds'),
        category: mapIconKey(device.category),
        color: showStatus ? position.attributes.color || getStatusColor(device.status) : 'neutral',
        rotation: position.course,
        direction: showDirection,
        sensorLabel: sensorLines.join('\n'),
        sensorColor: sensorAlert ? (blink ? '#ff0000' : '#ff000033') : '#444444',
      };
    },
    [directionType, showStatus, serverAttributes, blink],
  );

  const hasAlerts = positions.some((position) => {
    const device = devices[position.deviceId];
    if (!device) return false;
    return Object.entries(position.attributes).some(([key, value]) => {
      const min = device.attributes[`sensorMin.${key}`];
      const max = device.attributes[`sensorMax.${key}`];
      return (min !== undefined && value < Number(min)) || (max !== undefined && value > Number(max));
    });
  });

  useEffect(() => {
    if (!hasAlerts) return;
    const interval = setInterval(() => setBlink((b) => !b), 600);
    return () => clearInterval(interval);
  }, [hasAlerts]);

  const onMouseEnter = () => (map.getCanvas().style.cursor = 'pointer');
  const onMouseLeave = () => (map.getCanvas().style.cursor = '');

  const onMapClickCallback = useCallback(
    (event) => {
      if (!event.defaultPrevented && onMapClick) {
        onMapClick(event.lngLat.lat, event.lngLat.lng);
      }
    },
    [onMapClick],
  );

  const onMarkerClickCallback = useCallback(
    (event) => {
      if (disabledRef.current) return;
      event.preventDefault();
      const feature = event.features[0];
      if (onMarkerClick) {
        onMarkerClick(feature.properties.id, feature.properties.deviceId);
      }
    },
    [onMarkerClick],
  );

  const onClusterClick = useCatchCallback(
    async (event) => {
      if (disabledRef.current) return;
      event.preventDefault();
      const features = map.queryRenderedFeatures(event.point, {
        layers: [clusters],
      });
      const clusterId = features[0].properties.cluster_id;
      const zoom = await map.getSource(id).getClusterExpansionZoom(clusterId);
      map.easeTo({
        center: features[0].geometry.coordinates,
        zoom,
      });
    },
    [clusters, id],
  );

  useEffect(() => {
    map.addSource(id, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [],
      },
      cluster: mapCluster,
      clusterMaxZoom: 14,
      clusterRadius: 50,
    });
    map.addSource(selected, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [],
      },
    });
    [id, selected].forEach((source) => {
      map.addLayer({
        id: source,
        type: 'symbol',
        source,
        filter: ['!has', 'point_count'],
        layout: {
          'icon-image': '{category}-{color}',
          'icon-size': iconScale,
          'icon-allow-overlap': true,
          'text-field': `{${titleField || 'name'}}`,
          'text-allow-overlap': true,
          'text-anchor': 'bottom',
          'text-offset': [0, -2 * iconScale],
          'text-font': findFonts(map),
          'text-size': 12,
          'symbol-sort-key': ['get', 'id'],
        },
        paint: {
          'text-halo-color': 'white',
          'text-halo-width': 1,
        },
      });
      map.addLayer({
        id: `direction-${source}`,
        type: 'symbol',
        source,
        filter: ['all', ['!has', 'point_count'], ['==', 'direction', true]],
        layout: {
          'icon-image': 'direction',
          'icon-size': iconScale,
          'icon-allow-overlap': true,
          'icon-rotate': ['get', 'rotation'],
          'icon-rotation-alignment': 'map',
        },
      });
      map.addLayer({
        id: `sensor-${source}`,
        type: 'symbol',
        source,
        filter: ['all', ['!has', 'point_count'], ['!=', 'sensorLabel', '']],
        layout: {
          'text-field': '{sensorLabel}',
          'text-allow-overlap': true,
          'text-anchor': 'top',
          'text-offset': [0, 2 * iconScale],
          'text-font': findFonts(map),
          'text-size': 13,
        },
        paint: {
          'text-color': ['get', 'sensorColor'],
          'text-halo-color': 'white',
          'text-halo-width': 1,
        },
      });

      map.on('mouseenter', source, onMouseEnter);
      map.on('mouseleave', source, onMouseLeave);
      map.on('click', source, onMarkerClickCallback);
    });
    map.addLayer({
      id: clusters,
      type: 'symbol',
      source: id,
      filter: ['has', 'point_count'],
      layout: {
        'icon-image': 'background',
        'icon-size': iconScale,
        'text-field': '{point_count_abbreviated}',
        'text-font': findFonts(map),
        'text-size': 14,
      },
    });

    map.on('mouseenter', clusters, onMouseEnter);
    map.on('mouseleave', clusters, onMouseLeave);
    map.on('click', clusters, onClusterClick);
    map.on('click', onMapClickCallback);

    return () => {
      map.off('mouseenter', clusters, onMouseEnter);
      map.off('mouseleave', clusters, onMouseLeave);
      map.off('click', clusters, onClusterClick);
      map.off('click', onMapClickCallback);

      if (map.getLayer(clusters)) {
        map.removeLayer(clusters);
      }

      [id, selected].forEach((source) => {
        map.off('mouseenter', source, onMouseEnter);
        map.off('mouseleave', source, onMouseLeave);
        map.off('click', source, onMarkerClickCallback);

        if (map.getLayer(source)) {
          map.removeLayer(source);
        }
        if (map.getLayer(`direction-${source}`)) {
          map.removeLayer(`direction-${source}`);
        }
        if (map.getLayer(`sensor-${source}`)) {
          map.removeLayer(`sensor-${source}`);
        }
        if (map.getSource(source)) {
          map.removeSource(source);
        }
      });
    };
  }, [
    mapCluster,
    clusters,
    onMarkerClickCallback,
    onClusterClick,
    onMapClickCallback,
    iconScale,
    id,
    selected,
    titleField,
  ]);

  useEffect(() => {
    [id, selected].forEach((source) => {
      map.getSource(source)?.setData({
        type: 'FeatureCollection',
        features: positions
          .filter((it) => devices.hasOwnProperty(it.deviceId))
          .filter((it) =>
            source === id ? it.deviceId !== selectedDeviceId : it.deviceId === selectedDeviceId,
          )
          .map((position) => ({
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [position.longitude, position.latitude],
            },
            properties: createFeature(devices, position, selectedPosition && selectedPosition.id),
          })),
      });
    });
  }, [
    mapCluster,
    clusters,
    onMarkerClick,
    onClusterClick,
    devices,
    positions,
    selectedPosition,
    createFeature,
    id,
    selected,
    selectedDeviceId,
  ]);

  return null;
};

export default MapPositions;
