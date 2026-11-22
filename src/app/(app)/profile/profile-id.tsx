"use client";

import { createContext, useContext } from "react";

// The profile a page shows (E24-1): its sections add, order and save to that
// profile's lists, whatever another tab has open.

const ProfileIdContext = createContext("");

export const ProfileIdProvider = ProfileIdContext;

/** The id of the profile on screen. */
export const useProfileId = () => useContext(ProfileIdContext);
