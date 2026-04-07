import {
  ReactRNPlugin,
  PropertyLocation,
  PropertyType,
} from '@remnote/plugin-sdk';
import {
  powerupCode,
  prioritySlotCode,
  nextRepDateSlotCode,
  repHistorySlotCode,
  originalIncrementalDateSlotCode,
  firstAddedSlotCode,
  rotationSlotCode,
  ROTATION_OPTIONS,
  priorityGraphPowerupCode,
  dismissedPowerupCode,
  dismissedHistorySlotCode,
  dismissedDateSlotCode,
  videoExtractPowerupCode,
  videoExtractUrlSlotCode,
  videoExtractStartSlotCode,
  videoExtractEndSlotCode,
} from '../lib/consts';
import { initIncrementalRem } from '../lib/incremental_rem';

// Re-export for backwards compatibility
export { initIncrementalRem };

/**
 * Registers the Incremental Everything powerups (and card priority powerup) with RemNote.
 *
 * @param plugin ReactRNPlugin entry point used to communicate with RemNote.
 * @returns Promise that resolves once both powerups are registered.
 */
export async function registerPluginPowerups(plugin: ReactRNPlugin) {
  // New, corrected registerPowerup format with a single object (since plugin-sdk@0.0.39)
  // `slots` is nested inside `options`
  await plugin.app.registerPowerup({
    name: 'Incremental',
    code: powerupCode,
    description: 'Incremental Everything Powerup',
    options: {
      slots: [
        {
          code: prioritySlotCode,
          name: 'Priority',
          propertyType: PropertyType.NUMBER,
          propertyLocation: PropertyLocation.BELOW,
        },
        {
          code: nextRepDateSlotCode,
          name: 'Next Rep Date',
          propertyType: PropertyType.DATE,
          propertyLocation: PropertyLocation.BELOW,
        },
        {
          code: repHistorySlotCode,
          name: 'History',
          hidden: true,
        },
        {
          code: originalIncrementalDateSlotCode,
          name: 'Created',
          propertyType: PropertyType.DATE,
          hidden: true,
        },
        {
          code: firstAddedSlotCode,
          name: 'First Added',
          propertyType: PropertyType.DATE,
          propertyLocation: PropertyLocation.BELOW,
        },
        {
          code: rotationSlotCode,
          name: 'Rotation',
          propertyType: PropertyType.SINGLE_SELECT,
          propertyLocation: PropertyLocation.BELOW,
        },
      ],
    },
  });

  await ensureRotationOptions(plugin);

  // Create Separate Flashcard Priority Powerup
  await plugin.app.registerPowerup({
    name: 'CardPriority',
    code: 'cardPriority',
    description: 'Priority system for flashcards',
    options: {
      slots: [
        {
          code: 'priority',
          name: 'Priority',
          propertyType: PropertyType.NUMBER,
          propertyLocation: PropertyLocation.BELOW,
        },
        {
          code: 'prioritySource',
          name: 'Priority Source',
          propertyType: PropertyType.TEXT,
          propertyLocation: PropertyLocation.BELOW,
        },
        {
          code: 'lastUpdated',
          name: 'Last Updated',
          propertyType: PropertyType.NUMBER,  // Timestamp
          hidden: true,
        }
      ],
    },
  });

  await plugin.app.registerPowerup({
    name: 'Priority Review Graph',
    code: priorityGraphPowerupCode,
    description: 'Displays a distribution graph of priorities for items in this document.',
    options: {
      slots: [] // No special slots needed, we just use the tag as a trigger
    }
  });



  // Dismissed Powerup - stores history of previously Incremental Rems
  await plugin.app.registerPowerup({
    name: 'Dismissed',
    code: dismissedPowerupCode,
    description: 'Stores history of previously Incremental Rems',
    options: {
      slots: [
        {
          code: dismissedHistorySlotCode,
          name: 'History',
          hidden: true,
        },
        {
          code: dismissedDateSlotCode,
          name: 'Dismissed Date',
          propertyType: PropertyType.DATE,
          hidden: true,
        },
      ],
    },
  });

  // Video Extract Powerup - stores start/end times for YouTube video segments
  await plugin.app.registerPowerup({
    name: 'VideoExtract',
    code: videoExtractPowerupCode,
    description: 'A segment extracted from a YouTube video with start/end times',
    options: {
      slots: [
        {
          code: videoExtractUrlSlotCode,
          name: 'Video URL',
          propertyType: PropertyType.TEXT,
          hidden: true,
        },
        {
          code: videoExtractStartSlotCode,
          name: 'Start Time',
          propertyType: PropertyType.NUMBER,
          hidden: true,
        },
        {
          code: videoExtractEndSlotCode,
          name: 'End Time',
          propertyType: PropertyType.NUMBER,
          hidden: true,
        },
      ],
    },
  });
}

async function ensureRotationOptions(plugin: ReactRNPlugin) {
  try {
    const rotationSlotRem = await plugin.powerup.getPowerupSlotByCode(
      powerupCode,
      rotationSlotCode
    );
    if (!rotationSlotRem) return;

    const existingChildren = await rotationSlotRem.getChildrenRem();
    const existingLabels = new Set<string>();
    for (const child of existingChildren) {
      const text = await plugin.richText.toString(child.text);
      existingLabels.add(text.trim());
    }

    for (const label of ROTATION_OPTIONS) {
      if (!existingLabels.has(label)) {
        const optionRem = await plugin.rem.createRem();
        if (optionRem) {
          await optionRem.setText([label]);
          await optionRem.setParent(rotationSlotRem._id);
        }
      }
    }
  } catch (error) {
    console.error('[ensureRotationOptions] Failed to create rotation options:', error);
  }
}
